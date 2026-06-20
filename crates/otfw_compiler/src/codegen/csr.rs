//! CSR backend — View IR → client-side JS that builds the DOM (ARCHITECTURE.md §6).
//!
//! Emits a factory function that declares the component's signals, constructs
//! the DOM (elements, text, fragments, static attributes), wires reactive text
//! holes and dynamic attributes through the runtime (`bindText` / `bindAttr`),
//! attaches event handlers, and returns the root node. Imports for the runtime
//! helpers actually used are emitted as a header.
//!
//! Not yet supported (reported as diagnostics + inert placeholders): component
//! usage (the Custom Element backend) and list rendering.

use otfw_ir::reactivity::SignalKind;

use crate::lower::{Lowered, SignalDecl};
use otfw_ir::view::{Prop, PropValue, ViewNode};

/// The CSR output for one component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsrModule {
    /// Generated JavaScript: imports + a factory function returning the root node.
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
    bind_text: bool,
    bind_attr: bool,
}

/// Emit a CSR factory function for a lowered component.
pub fn emit(lowered: &Lowered) -> CsrModule {
    let mut emitter =
        Emitter { lowered, out: String::new(), errors: Vec::new(), counter: 0, uses: Uses::default() };

    for decl in &lowered.decls {
        emitter.emit_decl(decl);
    }
    let root = emitter.emit_node(&lowered.ir.view);

    let export = &lowered.ir.id.export;
    let header = if export == "default" {
        "export default function () {\n".to_string()
    } else {
        format!("export function {export}() {{\n")
    };
    let imports = emitter.imports();
    let code = format!("{imports}{header}{body}  return {root};\n}}\n", body = emitter.out);

    CsrModule { code, errors: emitter.errors }
}

struct Emitter<'a> {
    lowered: &'a Lowered,
    out: String,
    errors: Vec<String>,
    counter: u32,
    uses: Uses,
}

impl Emitter<'_> {
    fn fresh(&mut self, prefix: &str) -> String {
        let name = format!("{prefix}{}", self.counter);
        self.counter += 1;
        name
    }

    fn line(&mut self, stmt: String) {
        self.out.push_str("  ");
        self.out.push_str(&stmt);
        self.out.push('\n');
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
            // `Prop`-kind signals come from the Custom Element path (not yet emitted here).
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
                    self.emit_prop(&var, prop);
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
                self.line(format!("bindText({var}, () => ({code}));"));
                var
            }
            ViewNode::Component { name, .. } => {
                self.errors
                    .push(format!("component usage not supported yet (Custom Element backend): <{name}>"));
                let var = self.fresh("c");
                self.line(format!("const {var} = document.createComment(\"component\");"));
                var
            }
        }
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

    fn emit_prop(&mut self, el: &str, prop: &Prop) {
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
                if let Some(event) = event_name(&prop.name) {
                    // Event handlers are attached once, not wrapped in an effect.
                    self.line(format!("{el}.{event} = {code};"));
                } else {
                    self.uses.bind_attr = true;
                    self.line(format!("bindAttr({el}, {}, () => ({code}));", js_string(&prop.name)));
                }
            }
        }
    }
}

/// The DOM event-handler property name for an `on*` prop (`onClick` → `onclick`).
fn event_name(prop: &str) -> Option<String> {
    if prop.len() > 2 && prop.starts_with("on") {
        Some(prop.to_ascii_lowercase())
    } else {
        None
    }
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

    fn emit_csr(source: &str) -> CsrModule {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("App.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let lowered = lower_component("/app/App.tsx", &parsed.program, source).expect("a component");
        emit(&lowered)
    }

    #[test]
    fn emits_static_nested_factory_without_imports() {
        let m = emit_csr("export function App() { return <div class=\"x\"><span>hi</span></div>; }");
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
    fn emits_reactive_counter() {
        let m = emit_csr(
            "export function Counter() { let count = $state(0); return <button onclick={() => count++}>{count}</button>; }",
        );
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
    fn emits_dynamic_attribute_binding() {
        let m = emit_csr(
            "export function C() { let cls = $state(\"a\"); return <div class={cls}></div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("bindAttr(el0, \"class\", () => (cls.value));"), "code: {}", m.code);
        assert!(m.code.contains("import { signal, bindAttr }"), "code: {}", m.code);
    }

    #[test]
    fn emits_derived_computed() {
        let m = emit_csr(
            "export function C() { let n = $state(2); let d = $derived(n * 2); return <p>{d}</p>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("const d = computed(() => n.value * 2);"), "code: {}", m.code);
        assert!(m.code.contains("import { signal, computed, bindText }"), "code: {}", m.code);
    }

    #[test]
    fn reports_component_usage_as_unsupported() {
        let m = emit_csr("export function App() { return <div><Foo/></div>; }");
        assert!(!m.is_complete());
        assert!(m.errors[0].contains("component usage"), "errors: {:?}", m.errors);
    }
}
