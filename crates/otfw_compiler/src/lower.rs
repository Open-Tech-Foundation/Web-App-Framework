//! Stage 3: Lower — Semantic Model → domain-specific IRs.
//!
//! This first pass produces the **View IR** (ARCHITECTURE.md §4.2): it walks a
//! component's returned JSX into a `ViewNode` tree. Dynamic holes and dynamic
//! props are interned as `ExpressionId`s; their source text is recorded in an
//! `ExprTable` — the bridge from the IR's opaque handle to actual content for
//! later stages (Reactivity IR, codegen).
//!
//! Scope of this pass (extended in later passes):
//! - Components are **function declarations** (named or `export default`).
//!   Arrow-function components are a follow-up.
//! - The view comes from a top-level `return <jsx>`.
//! - Reactivity, server, route, and metadata IRs are not yet derived; the
//!   `ComponentIR` carries an empty signal/import/export set for now.

use oxc::ast::ast::{
    Expression, Function, FunctionBody, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
    JSXChild, JSXElement, JSXElementName, JSXExpression, Program, Statement,
};
use oxc::span::{GetSpan, Span};

use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::{ComponentId, ComponentIR, ExpressionId};

/// Per-component table mapping an interned `ExpressionId` to the source text of
/// the expression it stands for.
///
/// Scratch only: it shares the component's arena index space and is never
/// serialized as a durable contract (ARCHITECTURE.md §4.8). Later stages replace
/// the stored text with a lowered expression form.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ExprTable {
    sources: Vec<String>,
}

impl ExprTable {
    fn intern(&mut self, text: &str) -> ExpressionId {
        let id = ExpressionId(self.sources.len() as u32);
        self.sources.push(text.to_string());
        id
    }

    /// The source text behind an interned expression, if the id is from this table.
    pub fn source(&self, id: ExpressionId) -> Option<&str> {
        self.sources.get(id.0 as usize).map(String::as_str)
    }

    pub fn len(&self) -> usize {
        self.sources.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

/// The output of Stage 3 for one component.
#[derive(Debug, Clone, PartialEq)]
pub struct Lowered {
    pub ir: ComponentIR,
    pub exprs: ExprTable,
    /// Non-fatal lowering diagnostics (unsupported constructs that were skipped).
    pub errors: Vec<String>,
}

/// Lower the first component in `program` to its View IR.
///
/// `module` is the canonical module path used to form the stable `ComponentId`
/// (ARCHITECTURE.md §4.8). Returns `None` only when no function component with a
/// returned JSX view is found.
pub fn lower_component(module: &str, program: &Program, source: &str) -> Option<Lowered> {
    let (export, func) = find_component(program)?;
    let body = func.body.as_deref()?;
    let jsx = returned_jsx(body)?;

    let mut lowerer = Lowerer::new(source);
    let view = lowerer.lower_root(jsx)?;

    let ir = ComponentIR {
        id: ComponentId::new(module, export),
        view,
        signals: Vec::new(),
        imports: Vec::new(),
        exports: Vec::new(),
    };
    Some(Lowered { ir, exprs: lowerer.exprs, errors: lowerer.errors })
}

/// Find the first function-declaration component and its export name.
/// `export default function` yields the export name `default`.
fn find_component<'a>(program: &'a Program<'a>) -> Option<(String, &'a Function<'a>)> {
    for stmt in &program.body {
        match stmt {
            Statement::FunctionDeclaration(f) if has_jsx_return(f) => {
                let name = f.id.as_ref().map(|id| id.name.as_str().to_string())?;
                return Some((name, f));
            }
            Statement::ExportNamedDeclaration(e) => {
                if let Some(oxc::ast::ast::Declaration::FunctionDeclaration(f)) = &e.declaration
                    && has_jsx_return(f)
                    && let Some(id) = &f.id
                {
                    return Some((id.name.as_str().to_string(), f));
                }
            }
            Statement::ExportDefaultDeclaration(e) => {
                if let oxc::ast::ast::ExportDefaultDeclarationKind::FunctionDeclaration(f) =
                    &e.declaration
                    && has_jsx_return(f)
                {
                    return Some(("default".to_string(), f));
                }
            }
            _ => {}
        }
    }
    None
}

fn has_jsx_return(func: &Function) -> bool {
    func.body.as_deref().and_then(returned_jsx).is_some()
}

/// The JSX expression of a top-level `return` in the function body, if any.
fn returned_jsx<'a>(body: &'a FunctionBody<'a>) -> Option<&'a Expression<'a>> {
    for stmt in &body.statements {
        if let Statement::ReturnStatement(ret) = stmt
            && let Some(arg) = &ret.argument
        {
            let unwrapped = unwrap_paren(arg);
            if matches!(unwrapped, Expression::JSXElement(_) | Expression::JSXFragment(_)) {
                return Some(unwrapped);
            }
        }
    }
    None
}

fn unwrap_paren<'a>(expr: &'a Expression<'a>) -> &'a Expression<'a> {
    match expr {
        Expression::ParenthesizedExpression(p) => unwrap_paren(&p.expression),
        other => other,
    }
}

struct Lowerer<'s> {
    source: &'s str,
    exprs: ExprTable,
    errors: Vec<String>,
}

impl<'s> Lowerer<'s> {
    fn new(source: &'s str) -> Self {
        Self { source, exprs: ExprTable::default(), errors: Vec::new() }
    }

    fn slice(&self, span: Span) -> &'s str {
        &self.source[span.start as usize..span.end as usize]
    }

    fn lower_root(&mut self, expr: &Expression) -> Option<ViewNode> {
        match unwrap_paren(expr) {
            Expression::JSXElement(el) => Some(self.lower_element(el)),
            Expression::JSXFragment(fr) => {
                Some(ViewNode::Fragment(self.lower_children(&fr.children)))
            }
            _ => {
                self.errors.push("component root is not a JSX element or fragment".into());
                None
            }
        }
    }

    fn lower_element(&mut self, el: &JSXElement) -> ViewNode {
        let name = self.element_name(&el.opening_element.name);
        let props = self.lower_attrs(el);
        let children = self.lower_children(&el.children);
        if is_component_name(&name) {
            ViewNode::Component { name, props, children }
        } else {
            ViewNode::Element { tag: name, props, children }
        }
    }

    fn lower_children(&mut self, children: &[JSXChild]) -> Vec<ViewNode> {
        children.iter().filter_map(|child| self.lower_child(child)).collect()
    }

    fn lower_child(&mut self, child: &JSXChild) -> Option<ViewNode> {
        match child {
            JSXChild::Text(t) => {
                let text = normalize_jsx_text(t.value.as_str());
                if text.is_empty() { None } else { Some(ViewNode::Text(text)) }
            }
            JSXChild::Element(el) => Some(self.lower_element(el)),
            JSXChild::Fragment(fr) => Some(ViewNode::Fragment(self.lower_children(&fr.children))),
            JSXChild::ExpressionContainer(c) => match &c.expression {
                JSXExpression::EmptyExpression(_) => None,
                expr => {
                    let id = self.exprs.intern(self.slice(expr.span()));
                    Some(ViewNode::Dynamic { expr: id })
                }
            },
            JSXChild::Spread(s) => {
                self.errors.push(format!("spread child unsupported: {}", self.slice(s.span)));
                None
            }
        }
    }

    fn lower_attrs(&mut self, el: &JSXElement) -> Vec<Prop> {
        let mut props = Vec::new();
        for item in &el.opening_element.attributes {
            match item {
                JSXAttributeItem::Attribute(attr) => {
                    let name = match &attr.name {
                        JSXAttributeName::Identifier(id) => id.name.as_str().to_string(),
                        JSXAttributeName::NamespacedName(n) => {
                            format!("{}:{}", n.namespace.name, n.name.name)
                        }
                    };
                    let value = match &attr.value {
                        // Valueless attribute (`<input disabled />`): present, no value.
                        None => PropValue::Static(String::new()),
                        Some(JSXAttributeValue::StringLiteral(s)) => {
                            PropValue::Static(s.value.as_str().to_string())
                        }
                        Some(JSXAttributeValue::ExpressionContainer(c)) => match &c.expression {
                            JSXExpression::EmptyExpression(_) => PropValue::Static(String::new()),
                            expr => PropValue::Dynamic(self.exprs.intern(self.slice(expr.span()))),
                        },
                        // JSX-valued props (`foo=<El/>`): treated as a dynamic expression.
                        Some(JSXAttributeValue::Element(e)) => {
                            PropValue::Dynamic(self.exprs.intern(self.slice(e.span)))
                        }
                        Some(JSXAttributeValue::Fragment(f)) => {
                            PropValue::Dynamic(self.exprs.intern(self.slice(f.span)))
                        }
                    };
                    props.push(Prop { name, value });
                }
                JSXAttributeItem::SpreadAttribute(s) => {
                    self.errors
                        .push(format!("spread prop unsupported: {}", self.slice(s.span)));
                }
            }
        }
        props
    }

    fn element_name(&self, name: &JSXElementName) -> String {
        match name {
            JSXElementName::Identifier(id) => id.name.as_str().to_string(),
            JSXElementName::IdentifierReference(r) => r.name.as_str().to_string(),
            JSXElementName::NamespacedName(n) => {
                format!("{}:{}", n.namespace.name, n.name.name)
            }
            JSXElementName::MemberExpression(m) => self.slice(m.span).to_string(),
            JSXElementName::ThisExpression(_) => "this".to_string(),
        }
    }
}

/// A name is a component (vs a host element) when it is capitalized or a member
/// expression (`Foo`, `Foo.Bar`); host elements are lowercase (`div`).
fn is_component_name(name: &str) -> bool {
    name.contains('.') || name.chars().next().is_some_and(|c| c.is_uppercase())
}

/// Collapse JSX text per the usual convention: runs of whitespace become a
/// single space and pure-whitespace text between tags is dropped. (A faithful
/// implementation of JSX's edge-trimming rules is a later refinement.)
fn normalize_jsx_text(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::parse::ParseSession;

    fn lower(source: &str) -> Lowered {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("App.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        lower_component("/app/App.tsx", &parsed.program, source).expect("a component")
    }

    #[test]
    fn lowers_static_nested_elements() {
        let lowered = lower("export function App() { return <div class=\"x\"><span>hi</span></div>; }");
        assert_eq!(lowered.ir.id.export, "App");
        let ViewNode::Element { tag, props, children } = &lowered.ir.view else {
            panic!("expected element, got {:?}", lowered.ir.view);
        };
        assert_eq!(tag, "div");
        assert_eq!(props, &[Prop { name: "class".into(), value: PropValue::Static("x".into()) }]);
        assert_eq!(children.len(), 1);
        let ViewNode::Element { tag, children, .. } = &children[0] else {
            panic!("expected span element");
        };
        assert_eq!(tag, "span");
        assert_eq!(children, &[ViewNode::Text("hi".into())]);
        assert!(lowered.errors.is_empty());
    }

    #[test]
    fn interns_dynamic_text_hole() {
        let lowered = lower("export function App() { return <p>{name}</p>; }");
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::Dynamic { expr } = &children[0] else {
            panic!("expected dynamic hole, got {:?}", children[0]);
        };
        assert_eq!(lowered.exprs.source(*expr), Some("name"));
    }

    #[test]
    fn distinguishes_component_and_dynamic_prop() {
        let lowered = lower("export function App() { return <Foo bar={1 + 2} />; }");
        let ViewNode::Component { name, props, .. } = &lowered.ir.view else {
            panic!("expected component, got {:?}", lowered.ir.view);
        };
        assert_eq!(name, "Foo");
        let PropValue::Dynamic(expr) = props[0].value else { panic!("expected dynamic prop") };
        assert_eq!(lowered.exprs.source(expr), Some("1 + 2"));
    }

    #[test]
    fn lowers_default_export_and_fragment() {
        let lowered = lower("export default function() { return <><a/>{x}</>; }");
        assert_eq!(lowered.ir.id.export, "default");
        let ViewNode::Fragment(children) = &lowered.ir.view else {
            panic!("expected fragment, got {:?}", lowered.ir.view);
        };
        assert_eq!(children.len(), 2);
        assert!(matches!(children[0], ViewNode::Element { .. }));
        assert!(matches!(children[1], ViewNode::Dynamic { .. }));
    }

    #[test]
    fn skips_whitespace_only_text() {
        let lowered = lower("export function App() { return <ul>\n  <li>a</li>\n</ul>; }");
        let ViewNode::Element { tag, children, .. } = &lowered.ir.view else { panic!() };
        assert_eq!(tag, "ul");
        assert_eq!(children.len(), 1, "whitespace between tags should be dropped");
    }
}
