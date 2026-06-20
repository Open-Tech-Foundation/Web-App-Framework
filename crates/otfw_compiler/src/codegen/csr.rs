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
//! Not yet supported (reported as diagnostics): props flowing into a component
//! body as signals, component children/slots, member-expression component names,
//! `ref`, and list rendering.

use otfw_ir::reactivity::SignalKind;
use otfw_ir::view::{Prop, PropValue, ViewNode};

use crate::lower::{Lowered, SignalDecl};

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
}

/// Emit a page/layout as a factory function returning the root DOM node.
pub fn emit_page(lowered: &Lowered) -> CsrModule {
    let mut e = Emitter::new(lowered, Disposal::None);
    let root = e.emit_all();

    let export = &lowered.ir.id.export;
    let header = if export == "default" {
        "export default function () {\n".to_string()
    } else {
        format!("export function {export}() {{\n")
    };
    let code = format!("{}{}{}  return {root};\n}}\n", e.imports(), header, e.render("  "));
    CsrModule { code, errors: e.errors }
}

/// Emit a UI component as a Custom Element class + `customElements.define`.
pub fn emit_component(lowered: &Lowered) -> CsrModule {
    let export = lowered.ir.id.export.clone();
    let mut e = Emitter::new(lowered, Disposal::Sink("this._cleanups"));
    let root = e.emit_all();

    let class = format!("{export}Element");
    let tag = component_tag(&export);
    let body = e.render("    ");

    let mut code = String::new();
    code.push_str(&e.imports());
    code.push_str(&format!("export class {class} extends HTMLElement {{\n"));
    code.push_str("  connectedCallback() {\n");
    code.push_str("    if (this._mounted) return;\n");
    code.push_str("    this._mounted = true;\n");
    code.push_str("    this._cleanups = [];\n");
    code.push_str(&body);
    code.push_str(&format!("    this.appendChild({root});\n"));
    code.push_str("  }\n");
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
}

impl<'a> Emitter<'a> {
    fn new(lowered: &'a Lowered, disposal: Disposal) -> Self {
        Self { lowered, lines: Vec::new(), errors: Vec::new(), counter: 0, uses: Uses::default(), disposal }
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

    /// Emit signal declarations + the view, returning the root variable.
    fn emit_all(&mut self) -> String {
        for decl in &self.lowered.decls {
            self.emit_decl(decl);
        }
        self.emit_node(&self.lowered.ir.view)
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
                self.line(format!("const {var} = document.createElement({});", js_string(tag)));
                for prop in props {
                    self.emit_element_prop(&var, prop);
                }
                for child in children {
                    self.emit_append(&var, child);
                }
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
        }
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
        if !children.is_empty() {
            self.errors
                .push(format!("component children/slots not supported yet: <{name}>"));
        }
        var
    }

    /// Append `child` to `parent`, inlining static text-node creation.
    fn emit_append(&mut self, parent: &str, child: &ViewNode) {
        if let ViewNode::Text(text) = child {
            self.line(format!(
                "{parent}.appendChild(document.createTextNode({}));",
                js_string(text)
            ));
            return;
        }
        let child_var = self.emit_node(child);
        self.line(format!("{parent}.appendChild({child_var});"));
    }

    /// Props on a host element: static → attribute, dynamic → reactive attribute,
    /// `on*` → event handler (lowercased property, attached once).
    fn emit_element_prop(&mut self, el: &str, prop: &Prop) {
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
    fn reports_component_children_as_unsupported() {
        let m = emit_page(&lower("export function App() { return <Wrap><span/></Wrap>; }"));
        assert!(!m.is_complete());
        assert!(m.errors[0].contains("children/slots"), "errors: {:?}", m.errors);
    }
}
