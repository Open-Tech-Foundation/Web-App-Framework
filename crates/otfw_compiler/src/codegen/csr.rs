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

use crate::lower::{module_shell, BodyItem, ExprTable, Lowered, SignalDecl};

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
#[derive(Default, Clone)]
struct Uses {
    signal: bool,
    computed: bool,
    effect: bool,
    bind_text: bool,
    bind_attr: bool,
    bind_list: bool,
    bind_child: bool,
    spread: bool,
    report_error: bool,
    host: bool,
}

impl Uses {
    /// Union another unit's helper usage into this one (for module-level headers).
    fn merge(&mut self, o: &Uses) {
        self.signal |= o.signal;
        self.computed |= o.computed;
        self.effect |= o.effect;
        self.bind_text |= o.bind_text;
        self.bind_attr |= o.bind_attr;
        self.bind_list |= o.bind_list;
        self.bind_child |= o.bind_child;
        self.spread |= o.spread;
        self.report_error |= o.report_error;
        self.host |= o.host;
    }
}

/// Build the `import { … } from "@opentf/web";` header for the given helper usage,
/// merged with the source's own runtime imports (deduped).
fn import_header(uses: &Uses, runtime_imports: &[String]) -> String {
    let mut names = Vec::new();
    if uses.signal {
        names.push("signal");
    }
    if uses.computed {
        names.push("computed");
    }
    if uses.effect {
        names.push("effect");
    }
    if uses.bind_text {
        names.push("bindText");
    }
    if uses.bind_attr {
        names.push("bindAttr");
    }
    if uses.bind_list {
        names.push("bindList");
    }
    if uses.bind_child {
        names.push("bindChild");
    }
    if uses.spread {
        names.push("spread");
    }
    if uses.report_error {
        names.push("reportError");
    }
    if uses.host {
        names.push("enterHost");
        names.push("exitHost");
    }
    let mut merged: Vec<String> = names.into_iter().map(str::to_string).collect();
    for name in runtime_imports {
        if !merged.contains(name) {
            merged.push(name.clone());
        }
    }
    if merged.is_empty() {
        return String::new();
    }
    format!("import {{ {} }} from \"@opentf/web\";\n", merged.join(", "))
}

/// Emit a page/layout as a factory function returning the root DOM node.
pub fn emit_page(lowered: &Lowered) -> CsrModule {
    let (e, body) = page_body(lowered);
    let code = format!("{}{}{}", e.user_imports(), e.imports(), body);
    CsrModule { code, errors: e.errors }
}

/// Build a page factory body (everything after the import header).
fn page_body(lowered: &Lowered) -> (Emitter<'_>, String) {
    let mut e = Emitter::new(lowered, Disposal::None);
    let root = e.emit_all();
    e.emit_effects();
    if !lowered.props.is_empty() {
        e.errors.push("page/factory props not supported yet (use a component)".into());
    }
    if !lowered.exposes.is_empty() {
        e.errors.push("$expose is only supported in components (no element to expose on)".into());
    }

    // Lifecycle: a factory has no element to own teardown, so it attaches a
    // `__lifecycle` record to the root node. `mount` runs the `onMount` callbacks
    // after insertion; the router runs `cleanups` when navigating away.
    let mut lifecycle = String::new();
    if e.has_lifecycle() {
        lifecycle.push_str("  const __lifecycle = { mounts: [], cleanups: [] };\n");
        lifecycle.push_str(&e.render_stmts("  ", &e.on_cleanup_stmts("__lifecycle.cleanups")));
        lifecycle.push_str(&e.render_stmts("  ", &e.on_mount_stmts("__lifecycle.mounts")));
        lifecycle.push_str(&format!("  {root}.__lifecycle = __lifecycle;\n"));
    }

    // Pages/layouts receive a plain props object (`{ params, query, children }`)
    // from the router; emit the declared parameter name so `props.*` resolves.
    let param = lowered.page_param.as_deref().unwrap_or("");
    let export = &lowered.ir.id.export;
    let header = if export == "default" {
        format!("export default function ({param}) {{\n")
    } else {
        format!("export function {export}({param}) {{\n")
    };
    let body = format!("{header}{}{lifecycle}  return {root};\n}}\n", e.render("  "));
    (e, body)
}

/// Emit a UI component as a Custom Element class + `customElements.define`.
pub fn emit_component(lowered: &Lowered) -> CsrModule {
    let (e, body) = component_body(lowered);
    let code = format!("{}{}{}", e.user_imports(), e.imports(), body);
    CsrModule { code, errors: e.errors }
}

/// Build a Custom Element class body (everything after the import header).
/// `default_export` adds `export default <Class>;` (so the module can be imported
/// by default), used for standalone component modules.
fn component_body_ex(lowered: &Lowered, default_export: bool) -> (Emitter<'_>, String) {
    // Tag/class come from the function name (not the export), so `export default
    // function Counter` registers `web-counter` to match a page's `<Counter/>`.
    let export = lowered.name.clone();
    let props = &lowered.props;

    let mut e = Emitter::new(lowered, Disposal::Sink("this._cleanups"));
    e.emit_children_capture();
    e.emit_prop_aliases();
    e.emit_prop_snapshots();
    e.emit_rest();
    let root = e.emit_all();
    e.emit_effects();
    e.emit_exposes();
    // `onCleanup` teardown is registered during connect (run on disconnect).
    for stmt in e.on_cleanup_stmts("this._cleanups") {
        e.line(stmt);
    }
    if !props.is_empty() {
        e.uses.signal = true; // the constructor initializes prop signals
    }

    let class = format!("{export}Element");
    let tag = component_tag(&export);
    let body = e.render("    ");
    // `onMount` callbacks run after the view is appended; a returned function is
    // collected as additional teardown.
    let mut mounts = String::new();
    for cb in &lowered.on_mounts {
        mounts.push_str(&format!(
            "    {{ const __d = ({cb})(); if (typeof __d === \"function\") this._cleanups.push(__d); }}\n"
        ));
    }

    let mut code = String::new();
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

    // The build (view + bindings + mounts) is wrapped so a throwing component
    // fails soft — it is reported (surfacing in the dev overlay) instead of
    // breaking sibling components mid-render. A context-consuming component also
    // brackets the build with the host stack so `useContext` can resolve its
    // provider via the DOM (`closest`), even across nested connects.
    e.uses.report_error = true;
    let host = lowered.needs_host;
    if host {
        e.uses.host = true;
    }
    code.push_str("  connectedCallback() {\n");
    code.push_str("    if (this._mounted) return;\n");
    code.push_str("    this._mounted = true;\n");
    code.push_str("    this._cleanups = [];\n");
    if host {
        code.push_str("    enterHost(this);\n");
    }
    code.push_str("    try {\n");
    code.push_str(&body);
    code.push_str(&format!("    this.appendChild({root});\n"));
    code.push_str(&mounts);
    code.push_str("    } catch (e) {\n");
    code.push_str(&format!(
        "      reportError(e, {{ phase: \"render\", component: {} }});\n",
        js_string(&export)
    ));
    code.push_str("    }");
    if host {
        code.push_str(" finally {\n      exitHost();\n    }");
    }
    code.push('\n');
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
    if default_export {
        // Default-export the class so a consumer's `import Counter from "./Counter"`
        // resolves (the binding is unused — the component is referenced by tag — but
        // the import pulls the module in so its `define` runs).
        code.push_str(&format!("export default {class};\n"));
    }

    (e, code)
}

/// Single-component module: a Custom Element class with a default export.
fn component_body(lowered: &Lowered) -> (Emitter<'_>, String) {
    component_body_ex(lowered, true)
}

/// Emit a whole module: any preserved top-level statements (helper data,
/// module-level stores) followed by every component — the page factory (its
/// `is_page` flag) and co-located Custom Elements — under one merged import
/// header. This is the multi-component path used by the toolchain.
pub fn emit_module(
    components: &[Lowered],
    module_stmts: &[BodyItem],
    module_exprs: &ExprTable,
) -> CsrModule {
    let mut combined = Uses::default();
    let mut errors = Vec::new();
    let mut bodies = Vec::new();
    for c in components {
        let (e, body) = if c.is_page {
            page_body(c)
        } else {
            // The source's `export default` component re-exports its class as the
            // module default, so `import Counter from "./Counter"` resolves.
            component_body_ex(c, c.is_default_export)
        };
        combined.merge(&e.uses);
        errors.extend(e.errors);
        bodies.push(body);
    }

    // Emit the preserved module-level statements through a module-scope context so
    // any JSX-as-value declarations get their node-builders (and `Uses` merged into
    // the shared import header).
    let shell = module_shell("", module_exprs.clone(), module_stmts.to_vec());
    let mut me = Emitter::new(&shell, Disposal::None);
    for item in shell.body.clone() {
        match item {
            BodyItem::Signal(decl) => me.emit_decl(&decl),
            BodyItem::Raw(stmt) => me.line(stmt),
            BodyItem::Jsx { template, nodes } => me.emit_value_stmt(&template, &nodes),
        }
    }
    let module_code = me.render("");
    combined.merge(&me.uses);
    errors.extend(me.errors.clone());

    let mut code = String::new();
    if let Some(first) = components.first() {
        if !first.imports.is_empty() {
            code.push_str(&first.imports.join("\n"));
            code.push('\n');
        }
        code.push_str(&import_header(&combined, &first.runtime_imports));
    }
    if !module_code.is_empty() {
        code.push_str(&module_code);
        code.push('\n');
    }
    for body in bodies {
        code.push_str(&body);
    }
    CsrModule { code, errors }
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
        self.render_stmts(indent, &self.lines)
    }

    /// Render the given statements, one per line at `indent`.
    fn render_stmts(&self, indent: &str, stmts: &[String]) -> String {
        let mut out = String::new();
        for l in stmts {
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

    /// Emit the body (signal declarations + preserved statements, in source order)
    /// then the view, returning the root variable.
    fn emit_all(&mut self) -> String {
        for item in self.lowered.body.clone() {
            match item {
                BodyItem::Signal(decl) => self.emit_decl(&decl),
                BodyItem::Raw(stmt) => self.line(stmt),
                BodyItem::Jsx { template, nodes } => self.emit_value_stmt(&template, &nodes),
            }
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

    fn has_lifecycle(&self) -> bool {
        !self.lowered.on_mounts.is_empty() || !self.lowered.on_cleanups.is_empty()
    }

    /// `onCleanup(cb)` teardown registrations targeting `sink` (pushed as-is; run
    /// when the component/page is removed).
    fn on_cleanup_stmts(&self, sink: &str) -> Vec<String> {
        self.lowered
            .on_cleanups
            .iter()
            .map(|cb| format!("{sink}.push({cb});"))
            .collect()
    }

    /// `onMount(cb)` callbacks pushed into `sink` (run after the view is inserted;
    /// a returned function is collected as additional teardown by the runtime).
    fn on_mount_stmts(&self, sink: &str) -> Vec<String> {
        self.lowered
            .on_mounts
            .iter()
            .map(|cb| format!("{sink}.push({cb});"))
            .collect()
    }

    /// The module's preserved top-level imports (e.g. composed components), one
    /// per line, emitted before the runtime import so the bundler resolves them.
    fn user_imports(&self) -> String {
        if self.lowered.imports.is_empty() {
            return String::new();
        }
        format!("{}\n", self.lowered.imports.join("\n"))
    }

    /// The `import { … } from "@opentf/web";` header for the helpers used.
    fn imports(&self) -> String {
        import_header(&self.uses, &self.lowered.runtime_imports)
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

    /// Emit a preserved statement that embeds JSX as a value: a node-builder per
    /// embedded JSX, then the templated statement with each placeholder calling its
    /// builder (so `const icon = <Icon/>` becomes `const icon = Page_value0();`).
    fn emit_value_stmt(&mut self, template: &str, nodes: &[ViewNode]) {
        let mut calls = Vec::with_capacity(nodes.len());
        for node in nodes {
            let fn_name = format!("{}_value{}", self.base, self.list_counter);
            self.list_counter += 1;
            self.build_fn(&fn_name, node, "");
            calls.push(format!("{fn_name}()"));
        }
        self.line(substitute_branches(template, &calls));
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
            // A text hole: append the anchor text node *before* binding so that a
            // node-valued expression (JSX stored as a value) can insert before it on
            // the first run (the anchor must already be attached).
            ViewNode::Dynamic { expr } => {
                let code = self.lowered.exprs.code(*expr).unwrap_or("null").to_string();
                let var = self.fresh("t");
                self.line(format!("const {var} = document.createTextNode(\"\");"));
                self.line(format!("{parent}.appendChild({var});"));
                self.uses.bind_text = true;
                self.bind(format!("bindText({var}, () => ({code}))"));
            }
            ViewNode::Children => self.emit_children_slot(parent),
            _ => {
                let child_var = self.emit_node(child);
                self.line(format!("{parent}.appendChild({child_var});"));
            }
        }
    }

    /// Place the children into `parent` at the `{children}` slot. Components splice
    /// in their captured light-DOM nodes; page/layout factories append the node the
    /// router passed as `props.children`.
    fn emit_children_slot(&mut self, parent: &str) {
        if let Some(local) = self.lowered.children_local.clone() {
            let n = self.fresh("__c");
            self.line(format!("for (const {n} of {local}) {parent}.appendChild({n});"));
        } else if let Some(param) = self.lowered.page_param.clone() {
            self.line(format!("if ({param}.children) {parent}.appendChild({param}.children);"));
        } else {
            self.errors.push("children slot outside a component with children".into());
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
        lower_component("/app/App.tsx", &parsed.program, source, false).expect("a component")
    }

    /// Lower in page/layout mode (plain props, no signals).
    fn lower_page(source: &str) -> Lowered {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("page.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        lower_component("/app/page.tsx", &parsed.program, source, true).expect("a page")
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
             el0.appendChild(t1);\n  \
             bindText(t1, () => (count.value));\n  \
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
            "import { signal, bindText, reportError } from \"@opentf/web\";\n\
             export class CounterElement extends HTMLElement {\n  \
             connectedCallback() {\n    \
             if (this._mounted) return;\n    \
             this._mounted = true;\n    \
             this._cleanups = [];\n    \
             try {\n    \
             const count = signal(0);\n    \
             const el0 = document.createElement(\"button\");\n    \
             el0.onclick = () => count.value++;\n    \
             const t1 = document.createTextNode(\"\");\n    \
             el0.appendChild(t1);\n    \
             this._cleanups.push(bindText(t1, () => (count.value)));\n    \
             this.appendChild(el0);\n    \
             } catch (e) {\n      \
             reportError(e, { phase: \"render\", component: \"Counter\" });\n    \
             }\n  \
             }\n  \
             disconnectedCallback() {\n    \
             if (this._cleanups) for (const dispose of this._cleanups) dispose();\n    \
             this._cleanups = [];\n  \
             }\n\
             }\n\
             customElements.define(\"web-counter\", CounterElement);\n\
             export default CounterElement;\n"
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
    fn preserves_body_statements_in_order() {
        // Local data + a handler that mutates a signal must survive, in order,
        // with `.value` injected — referenced by the view.
        let m = emit_page(&lower(
            "export function C() { const base = 10; let n = $state(base); const inc = () => { n = n + 1; }; return <button onclick={inc}>{n}</button>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let base_at = m.code.find("const base = 10;").expect("base const");
        let sig_at = m.code.find("const n = signal(base);").expect("signal init from base");
        let inc_at = m.code.find("const inc = () => { n.value = n.value + 1; };").expect("handler");
        assert!(base_at < sig_at, "base before signal:\n{}", m.code);
        assert!(sig_at < inc_at, "signal before handler:\n{}", m.code);
        assert!(m.code.contains("el0.onclick = inc;"), "handler wired:\n{}", m.code);
    }

    #[test]
    fn page_uses_plain_props_no_value_injection() {
        // props.params.* is a plain access (no `.value`); the factory takes the
        // declared param.
        let m = emit_page(&lower_page(
            "export default function P(props) { return <h1>{props.params.id}</h1>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("export default function (props) {"), "code: {}", m.code);
        assert!(m.code.contains("bindText(t1, () => (props.params.id))"), "code: {}", m.code);
        assert!(!m.code.contains(".value"), "no signal .value on plain props:\n{}", m.code);
    }

    #[test]
    fn layout_renders_props_children_slot() {
        let m = emit_page(&lower_page(
            "export default function L(props) { return <main>{props.children}</main>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("if (props.children) el0.appendChild(props.children);"),
            "code: {}",
            m.code
        );
    }

    #[test]
    fn maps_classname_to_class() {
        let m = emit_page(&lower(
            "export function C() { let x = $state(\"a\"); return <div className=\"a\" htmlFor=\"y\"><span className={x}>hi</span></div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("setAttribute(\"class\", \"a\")"), "code: {}", m.code);
        assert!(m.code.contains("setAttribute(\"for\", \"y\")"), "code: {}", m.code);
        // Dynamic className also binds the `class` attribute.
        assert!(m.code.contains("bindAttr(el1, \"class\""), "code: {}", m.code);
        assert!(!m.code.contains("className"), "no raw className left:\n{}", m.code);
    }

    #[test]
    fn lowers_arrow_function_components() {
        // `const Icon = (props) => <svg/>` and a page that uses it must lower the
        // same as function-declaration components: a Custom Element + a factory.
        let source = "const Icon = ({ size = 24 }) => <svg width={size}></svg>;\n\
             export default function Page() { return <div><Icon size={32} /></div>; }";
        let sess = ParseSession::new();
        let parsed = sess.parse(Path::new("page.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = crate::lower::lower_module("/app/page.tsx", &parsed.program, source, true)
            .expect("a module");
        let out = emit_module(&m.components, &m.module_stmts, &m.module_exprs);
        assert!(out.is_complete(), "errors: {:?}", out.errors);
        // The arrow component becomes a Custom Element with its prop.
        assert!(out.code.contains("class IconElement extends HTMLElement"), "icon CE:\n{}", out.code);
        assert!(out.code.contains("customElements.define(\"web-icon\", IconElement);"), "icon defined:\n{}", out.code);
        assert!(out.code.contains("observedAttributes = [\"size\"]"), "icon prop:\n{}", out.code);
        // No raw JSX survives into the output.
        assert!(!out.code.contains("<svg"), "no raw JSX:\n{}", out.code);
        assert!(!out.code.contains("=>") || !out.code.contains("<Icon"), "no raw <Icon:\n{}", out.code);
    }

    #[test]
    fn lowers_jsx_stored_as_a_value() {
        // JSX in a value position (object literal) is lowered to node-builders and
        // the statement keeps the structure with builder calls — no raw JSX leaks.
        let m = emit_page(&lower(
            "export default function P() { const icon = <i>x</i>; const map = { a: <b>y</b> }; let s = $state(\"a\"); return <div>{icon}{map[s]}</div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(!m.code.contains("<i>") && !m.code.contains("<b>"), "no raw JSX:\n{}", m.code);
        // Builder functions for each embedded JSX value.
        assert!(m.code.contains("_value0()"), "value builder:\n{}", m.code);
        assert!(m.code.contains("const icon = "), "icon kept:\n{}", m.code);
        assert!(m.code.contains("const map = {"), "map kept:\n{}", m.code);
        // The text-hole anchor is appended before binding (so node values insert).
        let appended = m.code.find("appendChild(t").unwrap();
        let bound = m.code.find("bindText(t").unwrap();
        assert!(appended < bound, "anchor appended before bind:\n{}", m.code);
    }

    #[test]
    fn lowers_module_level_jsx_value_map() {
        // The classic `const iconMap = { a: <A/> }` at module scope: the map keeps
        // its shape with module-scope node-builders; no raw JSX leaks.
        let source = "const A = () => <i>a</i>;\n\
             const map = { a: <A/> };\n\
             export default function P() { let s = $state(\"a\"); return <div>{map[s]}</div>; }";
        let sess = ParseSession::new();
        let parsed = sess.parse(Path::new("page.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = crate::lower::lower_module("/app/page.tsx", &parsed.program, source, true)
            .expect("a module");
        let out = emit_module(&m.components, &m.module_stmts, &m.module_exprs);
        assert!(out.is_complete(), "errors: {:?}", out.errors);
        assert!(!out.code.contains("<i>") && !out.code.contains("<A/>"), "no raw JSX:\n{}", out.code);
        assert!(out.code.contains("function module_value0()"), "module builder:\n{}", out.code);
        assert!(out.code.contains("const map = { a: module_value0() };"), "map templated:\n{}", out.code);
    }

    #[test]
    fn lowers_arrow_default_export_page() {
        // `export default () => <jsx>` is a valid page factory.
        let m = emit_page(&lower_page(
            "export default () => <main><h1>Hi</h1></main>;",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("export default function ("), "factory:\n{}", m.code);
        assert!(m.code.contains("createElement(\"main\")"), "builds view:\n{}", m.code);
        assert!(!m.code.contains("<main"), "no raw JSX:\n{}", m.code);
    }

    #[test]
    fn emits_all_components_and_preserves_module_statements() {
        // A page module declaring a co-located component, a module-level store, and
        // a plain helper. emit_module must emit ONE runtime import header, the
        // preserved top-level statements, the page factory (default export), and the
        // co-located component as a Custom Element.
        let source = "import { signal } from \"@opentf/web\";\n\
             export const store = signal(0);\n\
             const LABEL = \"hi\";\n\
             function Badge() { return <span>{store}</span>; }\n\
             export default function Page() { return <div><span>{LABEL}</span></div>; }";
        let sess = ParseSession::new();
        let parsed = sess.parse(Path::new("page.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = crate::lower::lower_module("/app/page.tsx", &parsed.program, source, true)
            .expect("a module");
        let out = emit_module(&m.components, &m.module_stmts, &m.module_exprs);
        assert!(out.is_complete(), "errors: {:?}", out.errors);
        // Single merged runtime import header.
        assert_eq!(
            out.code.matches("from \"@opentf/web\"").count(),
            1,
            "one runtime header:\n{}",
            out.code
        );
        // Preserved module-level statements (verbatim).
        assert!(out.code.contains("export const store = signal(0);"), "store kept:\n{}", out.code);
        assert!(out.code.contains("const LABEL = \"hi\";"), "helper kept:\n{}", out.code);
        // The co-located component becomes a Custom Element; the default export the page.
        assert!(out.code.contains("class BadgeElement extends HTMLElement"), "badge CE:\n{}", out.code);
        assert!(out.code.contains("customElements.define(\"web-badge\", BadgeElement);"), "badge defined:\n{}", out.code);
        assert!(out.code.contains("export default function () {"), "page factory:\n{}", out.code);
    }

    #[test]
    fn component_module_default_exports_the_main_class() {
        // A component module (`export default function Counter`) plus a co-located
        // helper component. The default-export component re-exports its class so a
        // consumer's `import Counter from "./Counter"` resolves; the co-located one
        // only registers its tag (no extra default export).
        let source = "function Badge() { return <span>x</span>; }\n\
             export default function Counter() { let n = $state(0); return <button onclick={() => n++}>{n}</button>; }";
        let sess = ParseSession::new();
        let parsed = sess.parse(Path::new("Counter.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = crate::lower::lower_module("/app/Counter.tsx", &parsed.program, source, false)
            .expect("a module");
        let out = emit_module(&m.components, &m.module_stmts, &m.module_exprs);
        assert!(out.is_complete(), "errors: {:?}", out.errors);
        assert_eq!(
            out.code.matches("export default ").count(),
            1,
            "exactly one default export:\n{}",
            out.code
        );
        assert!(out.code.contains("export default CounterElement;"), "default is the main class:\n{}", out.code);
        assert!(out.code.contains("customElements.define(\"web-badge\", BadgeElement);"), "badge registered:\n{}", out.code);
    }

    #[test]
    fn merges_runtime_imports_without_duplicates() {
        // The source imports `signal`/`router` from the runtime; the generated
        // header also needs `signal`/`bindText`. They must merge into ONE import
        // with no duplicate `signal`, and macros ($state) are dropped.
        let m = emit_page(&lower(
            "import { signal, router, $state } from \"@opentf/web\";\nexport function C() { let n = $state(0); return <p>{n}</p>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let count = m.code.matches("from \"@opentf/web\"").count();
        assert_eq!(count, 1, "expected a single runtime import:\n{}", m.code);
        assert_eq!(m.code.matches("signal").count() > 0, true);
        assert!(m.code.contains("router"), "router kept:\n{}", m.code);
        assert!(!m.code.contains("$state"), "macro import dropped:\n{}", m.code);
        // No duplicate `signal` specifier in the import list.
        let header = m.code.lines().find(|l| l.contains("from \"@opentf/web\"")).unwrap();
        assert_eq!(header.matches("signal").count(), 1, "header: {header}");
    }

    #[test]
    fn component_emits_lifecycle_hooks() {
        let m = emit_component(&lower(
            "export function C() { let n = $state(0); onMount(() => console.log(n)); onCleanup(() => console.log(\"bye\", n)); return <p>{n}</p>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // `onCleanup` registers teardown during connect (.value injected).
        assert!(
            m.code.contains("this._cleanups.push(() => console.log(\"bye\", n.value));"),
            "code: {}",
            m.code
        );
        // `onMount` runs after the view is appended, collecting a returned disposer.
        let append = m.code.find("this.appendChild(el0);").expect("append");
        let run = m
            .code
            .find("const __d = (() => console.log(n.value))();")
            .expect("mount run");
        assert!(run > append, "onMount must run after append:\n{}", m.code);
    }

    #[test]
    fn page_emits_lifecycle_record() {
        let m = emit_page(&lower(
            "export function C() { let n = $state(0); onMount(() => console.log(n)); return <p>{n}</p>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("const __lifecycle = { mounts: [], cleanups: [] };"), "code: {}", m.code);
        assert!(
            m.code.contains("__lifecycle.mounts.push(() => console.log(n.value));"),
            "code: {}",
            m.code
        );
        assert!(m.code.contains("el0.__lifecycle = __lifecycle;"), "code: {}", m.code);
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
        assert!(m.code.contains("import { signal, bindText, bindChild, reportError }"), "code: {}", m.code);
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
        assert!(m.code.contains("import { signal, effect, bindChild, spread, reportError }"), "code: {}", m.code);
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
    fn preserves_module_imports() {
        let m = emit_page(&lower(
            "import Counter from \"../components/Counter\";\nexport default function App() { return <div><Counter/></div>; }",
        ));
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // The user import is re-emitted (so the bundler pulls Counter in) ahead of
        // the runtime import; the component is still referenced by tag.
        let user_at = m.code.find("import Counter from \"../components/Counter\";").expect("user import");
        let comp_at = m.code.find("document.createElement(\"web-counter\")").expect("tag");
        assert!(user_at < comp_at, "import must precede use; code: {}", m.code);
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
