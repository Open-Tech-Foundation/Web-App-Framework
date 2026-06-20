//! CSR backend — View IR → client-side JS that builds the DOM (ARCHITECTURE.md §6).
//!
//! Two emit shapes share one view-builder (the hybrid model, see
//! `new-runtime-decisions`):
//!
//! - [`emit_page`] — pages/layouts compile to a **factory function** that builds
//!   the DOM and returns the root node. Effects live for the app's lifetime.
//! - [`emit_component`] — UI components compile to a **Custom Element** class
//!   (`web-*`) whose `connectedCallback` builds the DOM and whose effect
//!   disposers are collected and torn down in `disconnectedCallback`.
//!
//! Both emit reactive text holes (`bindText`), dynamic attributes (`bindAttr`),
//! event handlers, signal declarations, and compose child components by tag.
//!
//! Not yet supported (reported as diagnostics): member-expression component
//! names and prop/children spreads.

use otfw_ir::reactivity::SignalKind;
use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::ExpressionId;

use crate::lower::{Lowered, SignalDecl};

/// The SVG namespace; elements under `<svg>` are created with `createElementNS`
/// (SPEC §5.8).
const SVG_NS: &str = "http://www.w3.org/2000/svg";

/// The CSR output for one component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsrModule {
    /// Generated JavaScript: imports + a factory function or Custom Element class.
    pub code: String,
    /// Diagnostics for constructs this pass cannot emit yet.
    pub errors: Vec<String>,
}

impl CsrModule {
    /// True when the whole component was emitted with no unsupported constructs.
    pub fn is_complete(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Which runtime helpers the generated code references (drives the import header).
#[derive(Default)]
struct Uses {
    signal: bool,
    computed: bool,
    effect: bool,
    bind_text: bool,
    bind_attr: bool,
    bind_list: bool,
    bind_child: bool,
    spread: bool,
}

/// Emit a page/layout as a factory function returning the root DOM node.
pub fn emit_page(lowered: &Lowered) -> CsrModule {
    let mut e = Emitter::new(lowered, Disposal::None);
    let root = e.emit_all();
    e.emit_effects();
    if !lowered.props.is_empty() {
        e.errors.push("page/factory props not supported yet (use a component)".into());
    }
    if !lowered.exposes.is_empty() {
        e.errors.push("$expose is only supported in components (no element to expose on)".into());
    }

    let export = &lowered.ir.id.export;
    let header = if export == "default" {
        "export default function () {\n".to_string()
    } else {
        format!("export function {export}() {{\n")
    };
    let code = format!(
        "{}{}{}  return {root};\n}}\n",
        e.imports(),
        header,
        e.render("  ")
    );
    CsrModule { code, errors: e.errors }
}

/// Emit a UI component as a Custom Element class + `customElements.define`.
pub fn emit_component(lowered: &Lowered) -> CsrModule {
    let export = lowered.ir.id.export.clone();
    let props = &lowered.props;

    let mut e = Emitter::new(lowered, Disposal::Sink("this._cleanups"));
    e.emit_children_capture();
    e.emit_prop_aliases();
    e.emit_prop_snapshots();
    e.emit_rest();
    let root = e.emit_all();
    e.emit_effects();
    e.emit_exposes();
    if !props.is_empty() {
        e.uses.signal = true; // the constructor initializes prop signals
    }

    let class = format!("{export}Element");
    let tag = component_tag(&export);
    let body = e.render("    ");

    let mut code = String::new();
    code.push_str(&e.imports());
    code.push_str(&format!("export class {class} extends HTMLElement {{\n"));

    if !props.is_empty() {
        let attrs = props.iter().map(|p| js_string(&p.attr)).collect::<Vec<_>>().join(", ");
        code.push_str(&format!("  static observedAttributes = [{attrs}];\n"));

        // Initialize prop signals from the attribute (or default) before connect.
        code.push_str("  constructor() {\n    super();\n    this._props = {\n");
        for p in props {
            let init = match &p.default {
                Some(d) => format!("this.getAttribute({}) ?? ({d})", js_string(&p.attr)),
                None => format!("this.getAttribute({})", js_string(&p.attr)),
            };
            code.push_str(&format!("      {}: signal({init}),\n", p.attr));
        }
        code.push_str("    };\n  }\n");

        // Property get/set bridge so `el.attr = x` updates the signal.
        for p in props {
            let k = js_string(&p.attr);
            code.push_str(&format!(
                "  get {attr}() {{ return this._props[{k}].value; }}\n  set {attr}(v) {{ this._props[{k}].value = v; }}\n",
                attr = p.attr
            ));
        }
    }

    code.push_str("  connectedCallback() {\n");
    code.push_str("    if (this._mounted) return;\n");
    code.push_str("    this._mounted = true;\n");
    code.push_str("    this._cleanups = [];\n");
    code.push_str(&body);
    code.push_str(&format!("    this.appendChild({root});\n"));
    code.push_str("  }\n");

    if !props.is_empty() {
        code.push_str("  attributeChangedCallback(name, _old, value) {\n");
        code.push_str("    const sig = this._props[name];\n");
        code.push_str("    if (sig) sig.value = value;\n");
        code.push_str("  }\n");
    }

    code.push_str("  disconnectedCallback() {\n");
    code.push_str("    if (this._cleanups) for (const dispose of this._cleanups) dispose();\n");
    code.push_str("    this._cleanups = [];\n");
    code.push_str("  }\n");
    code.push_str("}\n");
    code.push_str(&format!("customElements.define({}, {class});\n", js_string(&tag)));

    CsrModule { code, errors: e.errors }
}

/// Where effect disposers go: nowhere (page) or a collection sink (component).
#[derive(Clone, Copy)]
enum Disposal {
    None,
    Sink(&'static str),
}

struct Emitter<'a> {
    lowered: &'a Lowered,
    lines: Vec<String>,
    errors: Vec<String>,
    counter: u32,
    uses: Uses,
    disposal: Disposal,
    /// Prefix for generated list item-render functions (the component name).
    base: String,
    /// Counter for unique node-builder function names (list items, dynamic nodes).
    list_counter: u32,
    /// Whether the current element context is inside an `<svg>` subtree, so
    /// descendants are created with `createElementNS` (SPEC §5.8).
    in_svg: bool,
}

impl<'a> Emitter<'a> {
    fn new(lowered: &'a Lowered, disposal: Disposal) -> Self {
        let base = lowered.ir.id.export.clone();
        Self {
            lowered,
            lines: Vec::new(),
            errors: Vec::new(),
            counter: 0,
            uses: Uses::default(),
            disposal,
            base,
            list_counter: 0,
            in_svg: false,
        }
    }

    fn fresh(&mut self, prefix: &str) -> String {
        let name = format!("{prefix}{}", self.counter);
        self.counter += 1;
        name
    }

    /// Push a complete statement (no indentation; rendered later).
    fn line(&mut self, stmt: String) {
        self.lines.push(stmt);
    }

    /// Push an effect-returning call, collecting its disposer for components.
    fn bind(&mut self, call: String) {
        match self.disposal {
            Disposal::None => self.line(format!("{call};")),
            Disposal::Sink(sink) => self.line(format!("{sink}.push({call});")),
        }
    }

    fn render(&self, indent: &str) -> String {
        let mut out = String::new();
        for l in &self.lines {
            out.push_str(indent);
            out.push_str(l);
            out.push('\n');
        }
        out
    }

    /// Capture the light-DOM children before the view is built, then clear them
    /// from the host (they are re-placed at the `{children}` slot). Component
    /// path only; no-op when the component doesn't take children.
    fn emit_children_capture(&mut self) {
        if let Some(local) = self.lowered.children_local.clone() {
            self.line(format!("const {local} = Array.from(this.childNodes);"));
            self.line("this.replaceChildren();".to_string());
        }
    }

    /// Alias the prop signals so view references resolve to them. For destructured
    /// props, one binding per key (`const local = this._props["attr"];`). For the
    /// props-object form, a single `const props = this._props;` so First-Access
    /// references like `props.name.value` resolve to the keyed signal. Component
    /// path only.
    fn emit_prop_aliases(&mut self) {
        if let Some(props_local) = self.lowered.props_object.clone() {
            if !self.lowered.props.is_empty() {
                self.lines.push(format!("const {props_local} = this._props;"));
            }
            return;
        }
        for p in &self.lowered.props {
            self.lines.push(format!("const {} = this._props[{}];", p.local, js_string(&p.attr)));
        }
    }

    /// Emit one-time snapshots for nested destructuring patterns: destructure the
    /// (eagerly evaluated) prop value into the inner bindings. Non-reactive by
    /// design (SPEC §2.7 / `PropSnapshot`). Component path only.
    fn emit_prop_snapshots(&mut self) {
        for s in &self.lowered.prop_snapshots {
            self.lines
                .push(format!("const {} = ({}.value ?? {});", s.pattern, s.source, s.empty));
        }
    }

    /// Emit the `...rest` snapshot: a plain object of the element's attributes
    /// excluding the named props (SPEC §2.7). Non-reactive. Component path only.
    fn emit_rest(&mut self) {
        if let Some(rest) = &self.lowered.rest {
            let excl =
                rest.exclude.iter().map(|k| js_string(k)).collect::<Vec<_>>().join(", ");
            self.lines.push(format!("const {} = {{}};", rest.name));
            self.lines.push(format!(
                "for (const __a of Array.from(this.attributes)) if (![{excl}].includes(__a.name)) {}[__a.name] = __a.value;",
                rest.name
            ));
        }
    }

    /// Emit signal declarations + the view, returning the root variable.
    fn emit_all(&mut self) -> String {
        for decl in &self.lowered.decls {
            self.emit_decl(decl);
        }
        self.emit_node(&self.lowered.ir.view)
    }

    /// Emit top-level `$effect` callbacks, collecting disposers for cleanup
    /// (page: run for the app's lifetime; SPEC §3.2). Emitted after the view so
    /// effects can read refs assigned during the build.
    fn emit_effects(&mut self) {
        for cb in self.lowered.effects.clone() {
            self.uses.effect = true;
            self.bind(format!("effect({cb})"));
        }
    }

    /// Emit `$expose(obj)` as `Object.assign(this, obj)`, publishing the object's
    /// properties on the element (SPEC §3.2). Component path only.
    fn emit_exposes(&mut self) {
        for obj in self.lowered.exposes.clone() {
            self.line(format!("Object.assign(this, ({obj}));"));
        }
    }

    /// The `import { … } from "@opentf/web";` header for the helpers used.
    fn imports(&self) -> String {
        let mut names = Vec::new();
        if self.uses.signal {
            names.push("signal");
        }
        if self.uses.computed {
            names.push("computed");
        }
        if self.uses.effect {
            names.push("effect");
        }
        if self.uses.bind_text {
            names.push("bindText");
        }
        if self.uses.bind_attr {
            names.push("bindAttr");
        }
        if self.uses.bind_list {
            names.push("bindList");
        }
        if self.uses.bind_child {
            names.push("bindChild");
        }
        if self.uses.spread {
            names.push("spread");
        }
        if names.is_empty() {
            return String::new();
        }
        format!("import {{ {} }} from \"@opentf/web\";\n", names.join(", "))
    }

    fn emit_decl(&mut self, decl: &SignalDecl) {
        match decl.kind {
            SignalKind::State => {
                self.uses.signal = true;
                self.line(format!("const {} = signal({});", decl.name, decl.init));
            }
            SignalKind::Ref => {
                self.uses.signal = true;
                self.line(format!("const {} = signal(null);", decl.name));
            }
            SignalKind::Derived => {
                self.uses.computed = true;
                let body = if decl.init_is_fn {
                    decl.init.clone()
                } else {
                    format!("() => {}", decl.init)
                };
                self.line(format!("const {} = computed({});", decl.name, body));
            }
            // `Prop`-kind signals come from the (not yet implemented) props path.
            SignalKind::Prop => {
                self.errors.push(format!("prop signal not supported yet: {}", decl.name));
            }
        }
    }

    /// Emit the statements that build `node` and return the variable holding it.
    fn emit_node(&mut self, node: &ViewNode) -> String {
        match node {
            ViewNode::Element { tag, props, children } => {
                let var = self.fresh("el");
                // `<svg>` (or any element within one) is created in the SVG
                // namespace; `<foreignObject>` switches descendants back to HTML.
                let is_svg = self.in_svg || tag == "svg";
                let create = if is_svg {
                    format!("document.createElementNS(\"{SVG_NS}\", {})", js_string(tag))
                } else {
                    format!("document.createElement({})", js_string(tag))
                };
                self.line(format!("const {var} = {create};"));
                for prop in props {
                    self.emit_element_prop(&var, prop);
                }
                let prev = self.in_svg;
                self.in_svg = is_svg && tag != "foreignObject";
                for child in children {
                    self.emit_append(&var, child);
                }
                self.in_svg = prev;
                var
            }
            ViewNode::Text(text) => {
                let var = self.fresh("t");
                self.line(format!("const {var} = document.createTextNode({});", js_string(text)));
                var
            }
            ViewNode::Fragment(children) => {
                let var = self.fresh("frag");
                self.line(format!("const {var} = document.createDocumentFragment();"));
                for child in children {
                    self.emit_append(&var, child);
                }
                var
            }
            ViewNode::Dynamic { expr } => {
                let code = self.lowered.exprs.code(*expr).unwrap_or("null").to_string();
                let var = self.fresh("t");
                self.line(format!("const {var} = document.createTextNode(\"\");"));
                self.uses.bind_text = true;
                self.bind(format!("bindText({var}, () => ({code}))"));
                var
            }
            ViewNode::Component { name, props, children } => self.emit_component_use(name, props, children),
            ViewNode::DynamicNode { expr, branches } => {
                // A dynamic region as a node lives in its own fragment.
                let frag = self.fresh("frag");
                self.line(format!("const {frag} = document.createDocumentFragment();"));
                self.emit_dynamic_node(&frag, *expr, branches);
                frag
            }
            ViewNode::Children => {
                let frag = self.fresh("frag");
                self.line(format!("const {frag} = document.createDocumentFragment();"));
                self.emit_children_slot(&frag);
                frag
            }
            ViewNode::List { source, item_param, index_param, item, key } => {
                // A list as a node (e.g. a root list) lives in its own fragment.
                let frag = self.fresh("frag");
                self.line(format!("const {frag} = document.createDocumentFragment();"));
                self.emit_list(&frag, *source, item_param, index_param.as_deref(), item, *key);
                frag
            }
        }
    }

    /// Emit a list into `parent`: a module-level item-render function + a
    /// `bindList` call performing keyed reconciliation.
    fn emit_list(
        &mut self,
        parent: &str,
        source: ExpressionId,
        item_param: &str,
        index_param: Option<&str>,
        item: &ViewNode,
        key: Option<ExpressionId>,
    ) {
        let fn_name = format!("{}_item{}", self.base, self.list_counter);
        self.list_counter += 1;
        self.build_item_fn(&fn_name, item, item_param, index_param);

        let source_code = self.lowered.exprs.code(source).unwrap_or("[]").to_string();
        let key_fn = match key {
            Some(k) => {
                let code = self.lowered.exprs.code(k).unwrap_or("_index").to_string();
                format!("({item_param}, _index) => ({code})")
            }
            None => "undefined".to_string(),
        };
        self.uses.bind_list = true;
        self.bind(format!("bindList({parent}, () => ({source_code}), {fn_name}, {key_fn})"));
    }

    /// Build a module-level `function {fn_name}(item, index) { … return root; }`
    /// for a list item, accumulating it in `aux`.
    fn build_item_fn(
        &mut self,
        fn_name: &str,
        item: &ViewNode,
        item_param: &str,
        index_param: Option<&str>,
    ) {
        let index = index_param.unwrap_or("_index");
        self.build_fn(fn_name, item, &format!("{item_param}, {index}"));
    }

    /// Emit a **local** `function {fn_name}({params}) { … return root; }` that
    /// constructs `node`, into the current body so it closes over component
    /// signals/props. Inner effects are not collected (they live and die with the
    /// produced node).
    fn build_fn(&mut self, fn_name: &str, node: &ViewNode, params: &str) {
        let saved_lines = std::mem::take(&mut self.lines);
        let saved_counter = self.counter;
        let saved_disposal = self.disposal;
        self.counter = 0;
        self.disposal = Disposal::None;

        let root = self.emit_node(node);

        let body_lines = std::mem::replace(&mut self.lines, saved_lines);
        self.counter = saved_counter;
        self.disposal = saved_disposal;

        self.line(format!("function {fn_name}({params}) {{"));
        for l in &body_lines {
            self.line(format!("  {l}"));
        }
        self.line(format!("  return {root};"));
        self.line("}".to_string());
    }

    /// Emit a dynamic node region (conditional/element-valued hole) into `parent`:
    /// a comment anchor, a node-builder per embedded JSX branch, and a `bindChild`
    /// over the templated expression with each placeholder calling its builder.
    fn emit_dynamic_node(&mut self, parent: &str, expr: ExpressionId, branches: &[ViewNode]) {
        let anchor = self.fresh("a");
        self.line(format!("const {anchor} = document.createComment(\"\");"));
        self.line(format!("{parent}.appendChild({anchor});"));

        let mut calls = Vec::with_capacity(branches.len());
        for branch in branches {
            let fn_name = format!("{}_node{}", self.base, self.list_counter);
            self.list_counter += 1;
            self.build_fn(&fn_name, branch, "");
            calls.push(format!("{fn_name}()"));
        }

        let template = self.lowered.exprs.code(expr).unwrap_or("null").to_string();
        let code = substitute_branches(&template, &calls);
        self.uses.bind_child = true;
        self.bind(format!("bindChild({anchor}, () => ({code}))"));
    }

    /// Compose a child component: `<Foo .../>` → `document.createElement("web-foo")`.
    fn emit_component_use(&mut self, name: &str, props: &[Prop], children: &[ViewNode]) -> String {
        let var = self.fresh("c");
        if name.contains('.') {
            self.errors.push(format!("member-expression component not supported yet: <{name}>"));
            self.line(format!("const {var} = document.createComment(\"component\");"));
            return var;
        }
        let tag = component_tag(name);
        self.line(format!("const {var} = document.createElement({});", js_string(&tag)));
        for prop in props {
            self.emit_component_prop(&var, prop);
        }
        // Children are appended as light DOM; the component captures them at
        // connect and places them at its `{children}` slot (SPEC §4.5).
        for child in children {
            self.emit_append(&var, child);
        }
        var
    }

    /// Append `child` to `parent`, inlining static text-node creation and
    /// wiring lists directly into the parent (no intermediate node).
    fn emit_append(&mut self, parent: &str, child: &ViewNode) {
        match child {
            ViewNode::Text(text) => {
                self.line(format!(
                    "{parent}.appendChild(document.createTextNode({}));",
                    js_string(text)
                ));
            }
            ViewNode::List { source, item_param, index_param, item, key } => {
                self.emit_list(parent, *source, item_param, index_param.as_deref(), item, *key);
            }
            ViewNode::DynamicNode { expr, branches } => {
                self.emit_dynamic_node(parent, *expr, branches);
            }
            ViewNode::Children => self.emit_children_slot(parent),
            _ => {
                let child_var = self.emit_node(child);
                self.line(format!("{parent}.appendChild({child_var});"));
            }
        }
    }

    /// Place the captured child nodes into `parent` at the `{children}` slot.
    fn emit_children_slot(&mut self, parent: &str) {
        match self.lowered.children_local.clone() {
            Some(local) => {
                let n = self.fresh("__c");
                self.line(format!("for (const {n} of {local}) {parent}.appendChild({n});"));
            }
            None => self.errors.push("children slot outside a component with children".into()),
        }
    }

    /// `ref={expr}`: assign the node to the ref signal (`expr.value = el`,
    /// SPEC §5.6). The expression is raw (no `.value` injection).
    fn emit_ref(&mut self, el: &str, prop: &Prop) {
        if let PropValue::Dynamic(expr) = &prop.value {
            let code = self.lowered.exprs.code(*expr).unwrap_or("null").to_string();
            self.line(format!("{code}.value = {el};"));
        }
    }

    /// `{...obj}`: reactively apply the object's keys (SPEC §5.5). Wrapped in an
    /// effect so a reactive source re-applies; `as_props` sets element properties
    /// (components) vs attributes (host elements).
    fn emit_spread(&mut self, el: &str, prop: &Prop, as_props: bool) {
        if let PropValue::Dynamic(expr) = &prop.value {
            let code = self.lowered.exprs.code(*expr).unwrap_or("null").to_string();
            self.uses.effect = true;
            self.uses.spread = true;
            self.bind(format!("effect(() => spread({el}, ({code}), {as_props}))"));
        }
    }

    /// Props on a host element: static → attribute, dynamic → reactive attribute,
    /// `on*` → event handler (lowercased property, attached once).
    fn emit_element_prop(&mut self, el: &str, prop: &Prop) {
        if prop.name == "ref" {
            self.emit_ref(el, prop);
            return;
        }
        if prop.name.is_empty() {
            self.emit_spread(el, prop, false);
            return;
        }
        match &prop.value {
            PropValue::Static(value) => {
                self.line(format!(
                    "{el}.setAttribute({}, {});",
                    js_string(&prop.name),
                    js_string(value)
                ));
            }
            PropValue::Dynamic(expr) => {
                let code = self.lowered.exprs.code(*expr).unwrap_or("undefined").to_string();
                if is_event(&prop.name) {
                    self.line(format!("{el}.{} = {code};", prop.name.to_ascii_lowercase()));
                } else {
                    self.uses.bind_attr = true;
                    self.bind(format!("bindAttr({el}, {}, () => ({code}))", js_string(&prop.name)));
                }
            }
        }
    }

    /// Props on a child component: rich data is passed as **properties** —
    /// static → attribute, dynamic → reactive property set, `on*` → property
    /// (original case, set once) since the component owns its event semantics.
    fn emit_component_prop(&mut self, el: &str, prop: &Prop) {
        if prop.name == "ref" {
            self.emit_ref(el, prop);
            return;
        }
        if prop.name.is_empty() {
            self.emit_spread(el, prop, true);
            return;
        }
        match &prop.value {
            PropValue::Static(value) => {
                self.line(format!(
                    "{el}.setAttribute({}, {});",
                    js_string(&prop.name),
                    js_string(value)
                ));
            }
            PropValue::Dynamic(expr) => {
                let code = self.lowered.exprs.code(*expr).unwrap_or("undefined").to_string();
                if is_event(&prop.name) {
                    self.line(format!("{el}[{}] = {code};", js_string(&prop.name)));
                } else {
                    self.uses.effect = true;
                    self.bind(format!(
                        "effect(() => {{ {el}[{}] = ({code}); }})",
                        js_string(&prop.name)
                    ));
                }
            }
        }
    }
}

/// Replace each NUL-delimited slot placeholder (`\u{0}i\u{0}`) in a dynamic-node
/// template with its branch node-builder call.
fn substitute_branches(template: &str, calls: &[String]) -> String {
    let mut out = template.to_string();
    for (i, call) in calls.iter().enumerate() {
        out = out.replace(&format!("\u{0}{i}\u{0}"), call);
    }
    out
}

/// True for an `on*` event-handler prop name (`onClick`, `onclick`, …).
fn is_event(prop: &str) -> bool {
    prop.len() > 2 && prop.starts_with("on")
}

/// The Custom Element tag for a component name: `web-` + kebab-case.
fn component_tag(name: &str) -> String {
    format!("web-{}", kebab(name))
}

/// `Counter` → `counter`, `UserList` → `user-list`.
fn kebab(name: &str) -> String {
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Render a Rust string as a double-quoted JavaScript string literal.
fn js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::lower::lower_component;
    use crate::parse::ParseSession;

    fn lower(source: &str) -> Lowered {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("App.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        lower_component("/app/App.tsx", &parsed.program, source).expect("a component")
    }

    #[test]
    fn page_emits_static_factory_without_imports() {
        let m = emit_page(&lower(
            "export function App() { return <div class=\"x\"><span>hi</span></div>; }",
        ));
        assert!(m.is_complete(), "unexpected errors: {:?}", m.errors);
        assert_eq!(
            m.code,
            "export function App() {\n  \
             const el0 = document.createElement(\"div\");\n  \
             el0.setAttribute(\"class\", \"x\");\n  \
             const el1 = document.createElement(\"span\");\n  \
             el1.appendChild(document.createTextNode(\"hi\"));\n  \
             el0.appendChild(el1);\n  \
             return el0;\n}\n"
        );
    }

    #[test]
    fn page_emits_reactive_counter() {
        let m = emit_page(&lower(
            "export function Counter() { let count = $state(0); return <button onclick={() => count++}>{count}</button>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert_eq!(
            m.code,
            "import { signal, bindText } from \"@opentf/web\";\n\
             export function Counter() {\n  \
             const count = signal(0);\n  \
             const el0 = document.createElement(\"button\");\n  \
             el0.onclick = () => count.value++;\n  \
             const t1 = document.createTextNode(\"\");\n  \
             bindText(t1, () => (count.value));\n  \
             el0.appendChild(t1);\n  \
             return el0;\n}\n"
        );
    }

    #[test]
    fn component_emits_custom_element_class() {
        let m = emit_component(&lower(
            "export function Counter() { let count = $state(0); return <button onclick={() => count++}>{count}</button>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert_eq!(
            m.code,
            "import { signal, bindText } from \"@opentf/web\";\n\
             export class CounterElement extends HTMLElement {\n  \
             connectedCallback() {\n    \
             if (this._mounted) return;\n    \
             this._mounted = true;\n    \
             this._cleanups = [];\n    \
             const count = signal(0);\n    \
             const el0 = document.createElement(\"button\");\n    \
             el0.onclick = () => count.value++;\n    \
             const t1 = document.createTextNode(\"\");\n    \
             this._cleanups.push(bindText(t1, () => (count.value)));\n    \
             el0.appendChild(t1);\n    \
             this.appendChild(el0);\n  \
             }\n  \
             disconnectedCallback() {\n    \
             if (this._cleanups) for (const dispose of this._cleanups) dispose();\n    \
             this._cleanups = [];\n  \
             }\n\
             }\n\
             customElements.define(\"web-counter\", CounterElement);\n"
        );
    }

    #[test]
    fn page_composes_child_component_by_tag() {
        let m = emit_page(&lower("export function App() { return <div><UserList/></div>; }"));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("document.createElement(\"web-user-list\")"), "code: {}", m.code);
    }

    #[test]
    fn component_prop_dynamic_set_reactively() {
        let m = emit_page(&lower(
            "export function App() { let n = $state(1); return <Counter start={n}/>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("effect(() => { c0[\"start\"] = (n.value); })"),
            "code: {}",
            m.code
        );
    }

    #[test]
    fn component_emits_props_machinery() {
        let m = emit_component(&lower(
            "export function Greet({ name = \"World\" }) { return <div>{name}</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("static observedAttributes = [\"name\"];"), "code: {}", m.code);
        assert!(
            m.code.contains("name: signal(this.getAttribute(\"name\") ?? (\"World\")),"),
            "code: {}",
            m.code
        );
        assert!(m.code.contains("get name() { return this._props[\"name\"].value; }"), "code: {}", m.code);
        assert!(m.code.contains("set name(v) { this._props[\"name\"].value = v; }"), "code: {}", m.code);
        assert!(m.code.contains("const name = this._props[\"name\"];"), "code: {}", m.code);
        assert!(
            m.code.contains("attributeChangedCallback(name, _old, value)"),
            "code: {}",
            m.code
        );
        assert!(m.code.contains("bindText(t1, () => (name.value))"), "code: {}", m.code);
    }

    #[test]
    fn component_props_object_single_alias_and_machinery() {
        let m = emit_component(&lower(
            "export function Card(props) { return <div>{props.title}{props.user.name}</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Discovered keys drive the observed signals + bridge.
        assert!(m.code.contains("static observedAttributes = [\"title\", \"user\"];"), "code: {}", m.code);
        assert!(m.code.contains("get title()"), "code: {}", m.code);
        // A single alias to the backing store, not per-key locals.
        assert!(m.code.contains("const props = this._props;"), "code: {}", m.code);
        assert!(!m.code.contains("const title = this._props"), "code: {}", m.code);
        // First-Access references resolve through the alias.
        assert!(m.code.contains("bindText(t1, () => (props.title.value))"), "code: {}", m.code);
        assert!(m.code.contains("bindText(t2, () => (props.user.value.name))"), "code: {}", m.code);
    }

    #[test]
    fn component_emits_rest_snapshot() {
        let m = emit_component(&lower(
            "export function C({ a, ...rest }) { return <p>{a}{rest.b}</p>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // `a` observed; `rest` is a plain attribute snapshot excluding `a`.
        assert!(m.code.contains("static observedAttributes = [\"a\"];"), "code: {}", m.code);
        assert!(m.code.contains("const rest = {};"), "code: {}", m.code);
        assert!(
            m.code.contains("for (const __a of Array.from(this.attributes)) if (![\"a\"].includes(__a.name)) rest[__a.name] = __a.value;"),
            "code: {}",
            m.code
        );
        // `rest.b` is a plain (non-signal) access — no `.value`.
        assert!(m.code.contains("(rest.b)"), "code: {}", m.code);
    }

    #[test]
    fn component_emits_nested_snapshot() {
        let m = emit_component(&lower(
            "export function C({ user: { name } }) { return <p>{name}</p>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("static observedAttributes = [\"user\"];"), "code: {}", m.code);
        assert!(m.code.contains("const user = this._props[\"user\"];"), "code: {}", m.code);
        assert!(m.code.contains("const { name } = (user.value ?? {});"), "code: {}", m.code);
        // Snapshot binding is non-reactive: a plain read.
        assert!(m.code.contains("bindText(t1, () => (name))"), "code: {}", m.code);
    }

    #[test]
    fn emits_ref_assignment() {
        let m = emit_page(&lower(
            "export function C() { let box = $ref(); return <div ref={box}>hi</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("const box = signal(null);"), "code: {}", m.code);
        assert!(m.code.contains("box.value = el0;"), "code: {}", m.code);
    }

    #[test]
    fn emits_effect_with_disposal() {
        // Page: effect runs for the app lifetime (no disposal collection).
        let p = emit_page(&lower(
            "export function C() { let n = $state(0); $effect(() => console.log(n)); return <p>{n}</p>; }",
        ));
        assert!(p.is_complete(), "errors: {:?}", p.errors);
        assert!(p.code.contains("import { signal, effect, bindText }"), "code: {}", p.code);
        assert!(p.code.contains("effect(() => console.log(n.value));"), "code: {}", p.code);

        // Component: the disposer is collected for disconnectedCallback.
        let c = emit_component(&lower(
            "export function C() { let n = $state(0); $effect(() => console.log(n)); return <p>{n}</p>; }",
        ));
        assert!(c.is_complete(), "errors: {:?}", c.errors);
        assert!(
            c.code.contains("this._cleanups.push(effect(() => console.log(n.value)));"),
            "code: {}",
            c.code
        );
    }

    #[test]
    fn emits_conditional_dynamic_node() {
        let m = emit_component(&lower(
            "export function C() { let on = $state(true); let label = $state(\"hi\"); return <div>{on ? <strong>{label}</strong> : <em>off</em>}</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("import { signal, bindText, bindChild }"), "code: {}", m.code);
        // Builders are LOCAL (inside connectedCallback) so they close over `label`.
        assert!(m.code.contains("function C_node0() {"), "code: {}", m.code);
        assert!(m.code.contains("function C_node1() {"), "code: {}", m.code);
        // Inner reactive text inside a branch still wired.
        assert!(m.code.contains("bindText(t1, () => (label.value))"), "code: {}", m.code);
        // Anchor + bindChild over the templated expression with builder calls.
        assert!(m.code.contains("const a1 = document.createComment(\"\");"), "code: {}", m.code);
        assert!(
            m.code.contains("bindChild(a1, () => (on.value ? C_node0() : C_node1()))"),
            "code: {}",
            m.code
        );
    }

    #[test]
    fn emits_svg_with_namespace() {
        let m = emit_page(&lower(
            "export function Icon() { return <svg viewBox=\"0 0 1 1\"><circle cx=\"5\"/><foreignObject><div>x</div></foreignObject></svg>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // `<svg>` and descendants use createElementNS; camelCase attrs keep case.
        assert!(m.code.contains("document.createElementNS(\"http://www.w3.org/2000/svg\", \"svg\")"), "code: {}", m.code);
        assert!(m.code.contains("document.createElementNS(\"http://www.w3.org/2000/svg\", \"circle\")"), "code: {}", m.code);
        assert!(m.code.contains("setAttribute(\"viewBox\", \"0 0 1 1\")"), "code: {}", m.code);
        // `<foreignObject>` is SVG, but its `<div>` child switches back to HTML.
        assert!(m.code.contains("document.createElementNS(\"http://www.w3.org/2000/svg\", \"foreignObject\")"), "code: {}", m.code);
        assert!(m.code.contains("document.createElement(\"div\")"), "code: {}", m.code);
    }

    #[test]
    fn emits_spread_props_and_children() {
        let m = emit_component(&lower(
            "export function C() { let o = $state({}); let xs = $state([]); return <div {...o} class=\"base\">{...xs}</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("import { signal, effect, bindChild, spread }"), "code: {}", m.code);
        // Spread applied (effect), then the static class override — source order.
        let spread_at = m.code.find("effect(() => spread(el0, (o.value), false))").expect("spread");
        let class_at = m.code.find("el0.setAttribute(\"class\", \"base\")").expect("class");
        assert!(spread_at < class_at, "spread must precede the override; code: {}", m.code);
        // Spread child renders via bindChild over the array.
        assert!(m.code.contains("bindChild(a1, () => (xs.value))"), "code: {}", m.code);
    }

    #[test]
    fn emits_component_spread_as_properties() {
        let m = emit_page(&lower(
            "export function App() { let o = $state({}); return <Card {...o}/>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Component spread sets properties (asProps = true).
        assert!(m.code.contains("effect(() => spread(c0, (o.value), true))"), "code: {}", m.code);
    }

    #[test]
    fn emits_expose_and_page_rejects_it() {
        let c = emit_component(&lower(
            "export function C() { let n = $state(0); $expose({ inc: () => n++ }); return <p>{n}</p>; }",
        ));
        assert!(c.is_complete(), "errors: {:?}", c.errors);
        assert!(c.code.contains("Object.assign(this, ({ inc: () => n.value++ }));"), "code: {}", c.code);

        let p = emit_page(&lower(
            "export function P() { $expose({ a: 1 }); return <p>x</p>; }",
        ));
        assert!(!p.is_complete());
        assert!(p.errors.iter().any(|e| e.contains("$expose is only supported in components")), "errors: {:?}", p.errors);
    }

    #[test]
    fn page_with_props_reports_unsupported() {
        let m = emit_page(&lower("export function P({ x }) { return <p>{x}</p>; }"));
        assert!(!m.is_complete());
        assert!(m.errors.iter().any(|e| e.contains("page/factory props")), "errors: {:?}", m.errors);
    }

    #[test]
    fn emits_list_with_item_fn_and_bindlist() {
        let m = emit_page(&lower(
            "export function L() { let items = $state([]); return <ul>{items.map(i => <li>{i.name}</li>)}</ul>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("import { signal, bindText, bindList }"), "code: {}", m.code);
        // Module-level item renderer with the item param treated as a signal.
        assert!(m.code.contains("function L_item0(i, _index) {"), "code: {}", m.code);
        assert!(m.code.contains("bindText(t1, () => (i.value.name))"), "code: {}", m.code);
        // bindList wires source (outer signal) + renderer; no key → undefined.
        assert!(
            m.code.contains("bindList(el0, () => (items.value), L_item0, undefined)"),
            "code: {}",
            m.code
        );
    }

    #[test]
    fn emits_list_key_function() {
        let m = emit_page(&lower(
            "export function L() { let items = $state([]); return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("bindList(el0, () => (items.value), L_item0, (i, _index) => (i.id))"),
            "code: {}",
            m.code
        );
    }

    #[test]
    fn parent_appends_component_children_as_light_dom() {
        let m = emit_page(&lower("export function App() { return <Wrap><span/></Wrap>; }"));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // The child is built and appended to the component element.
        assert!(m.code.contains("document.createElement(\"web-wrap\")"), "code: {}", m.code);
        assert!(m.code.contains("document.createElement(\"span\")"), "code: {}", m.code);
        assert!(m.code.contains(".appendChild(el1)"), "code: {}", m.code);
    }

    #[test]
    fn component_captures_and_places_children_slot() {
        let m = emit_component(&lower(
            "export function Wrap({ children }) { return <div class=\"box\">{children}</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Captured before the view is built, then cleared from the host.
        assert!(m.code.contains("const children = Array.from(this.childNodes);"), "code: {}", m.code);
        assert!(m.code.contains("this.replaceChildren();"), "code: {}", m.code);
        // `children` is NOT an observed attribute/signal.
        assert!(!m.code.contains("observedAttributes"), "code: {}", m.code);
        // The slot places the captured nodes into the box.
        assert!(
            m.code.contains("for (const __c1 of children) el0.appendChild(__c1);"),
            "code: {}",
            m.code
        );
    }
}
