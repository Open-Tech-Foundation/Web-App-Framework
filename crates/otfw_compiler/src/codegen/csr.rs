//! CSR backend — View IR → client-side JS that builds the DOM (ARCHITECTURE.md §6).
//!
//! This first milestone is **static-first** (per the agreed sequencing): it emits
//! a factory function that constructs elements, text, fragments, and static
//! attributes, then returns the root node. Dynamic holes, dynamic props, and
//! component usage are not yet supported — they are reported as diagnostics and
//! emitted as inert placeholders so the output stays valid JS. Reactive holes
//! (`bindText`/`bindAttr` + `.value` injection) arrive once the Reactivity IR
//! and signal classification land.

use otfw_ir::view::{Prop, PropValue, ViewNode};

use crate::lower::Lowered;

/// The CSR output for one component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsrModule {
    /// Generated JavaScript: a factory function returning the root DOM node.
    pub code: String,
    /// Diagnostics for constructs this static-first pass cannot emit yet.
    pub errors: Vec<String>,
}

impl CsrModule {
    /// True when the whole view was emitted with no unsupported constructs.
    pub fn is_complete(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Emit a CSR factory function for a lowered component.
pub fn emit(lowered: &Lowered) -> CsrModule {
    let mut emitter = Emitter { lowered, out: String::new(), errors: Vec::new(), counter: 0 };
    let root = emitter.emit_node(&lowered.ir.view);

    let export = &lowered.ir.id.export;
    let header = if export == "default" {
        "export default function () {\n".to_string()
    } else {
        format!("export function {export}() {{\n")
    };
    let code = format!("{header}{body}  return {root};\n}}\n", body = emitter.out);

    CsrModule { code, errors: emitter.errors }
}

struct Emitter<'a> {
    lowered: &'a Lowered,
    out: String,
    errors: Vec<String>,
    counter: u32,
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

    /// Emit the statements that build `node` and return the variable holding it.
    fn emit_node(&mut self, node: &ViewNode) -> String {
        match node {
            ViewNode::Element { tag, props, children } => {
                let var = self.fresh("el");
                self.line(format!("const {var} = document.createElement({});", js_string(tag)));
                for prop in props {
                    self.emit_static_prop(&var, prop);
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
            ViewNode::Component { name, .. } => {
                self.errors
                    .push(format!("component usage not supported yet (static-first): <{name}>"));
                let var = self.fresh("c");
                self.line(format!("const {var} = document.createComment(\"component\");"));
                var
            }
            ViewNode::Dynamic { expr } => {
                let src = self.lowered.exprs.source(*expr).unwrap_or("?");
                self.errors
                    .push(format!("dynamic hole not supported yet (static-first): {{{src}}}"));
                let var = self.fresh("d");
                self.line(format!("const {var} = document.createTextNode(\"\");"));
                var
            }
        }
    }

    /// Append `child` to `parent`, inlining text-node creation to keep output tidy.
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

    fn emit_static_prop(&mut self, el: &str, prop: &Prop) {
        match &prop.value {
            PropValue::Static(value) => {
                self.line(format!(
                    "{el}.setAttribute({}, {});",
                    js_string(&prop.name),
                    js_string(value)
                ));
            }
            PropValue::Dynamic(expr) => {
                let src = self.lowered.exprs.source(*expr).unwrap_or("?");
                self.errors.push(format!(
                    "dynamic prop not supported yet (static-first): {}={{{src}}}",
                    prop.name
                ));
            }
        }
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
    fn emits_static_nested_factory() {
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
    fn emits_default_export() {
        let m = emit_csr("export default function() { return <p>hi</p>; }");
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.starts_with("export default function () {\n"));
        assert!(m.code.contains("document.createElement(\"p\")"));
    }

    #[test]
    fn escapes_text_and_attributes() {
        let m = emit_csr("export function App() { return <div title='a\"b'>{\"\"}c\\td</div>; }");
        // The attribute quote is escaped in the emitted literal.
        assert!(m.code.contains("\\\"b"), "code: {}", m.code);
    }

    #[test]
    fn reports_dynamic_hole_as_unsupported() {
        let m = emit_csr("export function App() { return <p>{name}</p>; }");
        assert!(!m.is_complete());
        assert_eq!(m.errors.len(), 1);
        assert!(m.errors[0].contains("dynamic hole"), "errors: {:?}", m.errors);
        // Output is still valid JS (inert placeholder text node).
        assert!(m.code.contains("document.createTextNode(\"\")"));
    }

    #[test]
    fn reports_component_usage_as_unsupported() {
        let m = emit_csr("export function App() { return <div><Foo/></div>; }");
        assert!(!m.is_complete());
        assert!(m.errors[0].contains("component usage"), "errors: {:?}", m.errors);
    }
}
