//! Stage 3: Lower — Semantic Model → domain-specific IRs.
//!
//! Produces the **View IR** (ARCHITECTURE.md §4.2) and the reactivity facts the
//! CSR backend needs: the component's signal declarations (from `$state` /
//! `$derived` / `$ref` macros) and, for every dynamic expression, the source
//! with `.value` injected on signal references plus its dependency set.
//!
//! Reactivity is derived from **resolved bindings**, not identifier names
//! (ARCHITECTURE.md principle 2): a macro declares a signal *symbol*, and a
//! reference is reactive only when it resolves to that symbol — so shadowed
//! names are handled correctly.
//!
//! Scope of this pass (extended later):
//! - Components are **function declarations** (named or `export default`) whose
//!   body is top-level macro declarations + a `return <jsx>`.
//! - Props reactivity (the Custom Element path), `ref`, lists, and `$effect`
//!   bodies are follow-ups.

use std::collections::HashMap;

use oxc::ast::ast::{
    Argument, ArrowFunctionExpression, BindingPattern, CallExpression, Declaration, Expression,
    ExportDefaultDeclarationKind, Function, FunctionBody, IdentifierReference, JSXAttributeItem,
    JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXElementName, JSXExpression,
    Program, Statement,
};
use oxc::ast_visit::Visit;
use oxc::semantic::{Scoping, SymbolId};
use oxc::span::{GetSpan, Span};

use otfw_ir::reactivity::{SignalInfo, SignalKind};
use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::{ComponentId, ComponentIR, ExpressionId, SignalId};

/// What an interned dynamic expression compiles to: source with `.value`
/// injected on signal references, plus the signals it reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExprInfo {
    /// JS expression source, ready to embed in generated code.
    pub code: String,
    /// Signals this expression depends on (deduplicated, in first-seen order).
    pub deps: Vec<SignalId>,
}

/// Per-component table mapping an interned `ExpressionId` to its `ExprInfo`.
///
/// Scratch only: shares the component's arena index space and is never
/// serialized as a durable contract (ARCHITECTURE.md §4.8).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ExprTable {
    entries: Vec<ExprInfo>,
}

impl ExprTable {
    fn intern(&mut self, info: ExprInfo) -> ExpressionId {
        let id = ExpressionId(self.entries.len() as u32);
        self.entries.push(info);
        id
    }

    /// The emit-ready JS source behind an interned expression.
    pub fn code(&self, id: ExpressionId) -> Option<&str> {
        self.entries.get(id.0 as usize).map(|e| e.code.as_str())
    }

    /// The dependency set behind an interned expression.
    pub fn deps(&self, id: ExpressionId) -> Option<&[SignalId]> {
        self.entries.get(id.0 as usize).map(|e| e.deps.as_slice())
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// A signal declaration to emit at the top of the generated factory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignalDecl {
    pub name: String,
    pub kind: SignalKind,
    /// The initializer source (`.value`-injected), e.g. `0` or `a.value * 2`.
    /// Empty for `$ref()`.
    pub init: String,
    /// Whether the `$derived` initializer is already a function literal (used
    /// directly) vs. a bare expression (the backend wraps it in an arrow).
    pub init_is_fn: bool,
}

/// A destructured component prop (`function C({ name: local = default })`).
///
/// `attr` is the public attribute/property name (observed + synced); `local` is
/// the in-body binding the view references. Both are reactive signal-backed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropDecl {
    pub local: String,
    pub attr: String,
    /// Default initializer source, applied when the attribute is absent.
    pub default: Option<String>,
}

/// The output of Stage 3 for one component.
#[derive(Debug, Clone, PartialEq)]
pub struct Lowered {
    pub ir: ComponentIR,
    pub exprs: ExprTable,
    /// Signal declarations (`$state`/`$derived`/`$ref`) to emit before the view.
    pub decls: Vec<SignalDecl>,
    /// Destructured component props (the Custom Element's observed signals).
    pub props: Vec<PropDecl>,
    /// The local binding name for the `children` slot, if the component
    /// destructures `children` (e.g. `"children"`). Drives child capture + the
    /// `Children` view node.
    pub children_local: Option<String>,
    /// Non-fatal lowering diagnostics (unsupported constructs that were skipped).
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MacroKind {
    State,
    Derived,
    Ref,
}

impl MacroKind {
    fn signal_kind(self) -> SignalKind {
        match self {
            MacroKind::State => SignalKind::State,
            MacroKind::Derived => SignalKind::Derived,
            MacroKind::Ref => SignalKind::Ref,
        }
    }
}

/// Lower the first component in `program` to its View IR + reactivity facts.
///
/// `module` is the canonical module path used to form the stable `ComponentId`
/// (ARCHITECTURE.md §4.8). Returns `None` only when no function component with a
/// returned JSX view is found.
pub fn lower_component<'a>(module: &str, program: &'a Program<'a>, source: &'a str) -> Option<Lowered> {
    let resolved = crate::semantic::resolve(program);
    let scoping = resolved.semantic.scoping();

    let (export, func) = find_component(program)?;
    let body = func.body.as_deref()?;

    let classified = classify(func, scoping, source);

    let children_symbol = classified.children.as_ref().and_then(|c| c.symbol);
    let children_local = classified.children.map(|c| c.local);

    let jsx = returned_jsx(body)?;
    let mut lowerer = Lowerer::new(source, scoping, classified.by_symbol, children_symbol);
    let view = lowerer.lower_root(jsx)?;

    let mut errors = classified.errors;
    errors.extend(lowerer.errors);

    let ir = ComponentIR {
        id: ComponentId::new(module, export),
        view,
        signals: classified.infos,
        imports: Vec::new(),
        exports: Vec::new(),
    };
    Some(Lowered {
        ir,
        exprs: lowerer.exprs,
        decls: classified.decls,
        props: classified.props,
        children_local,
        errors,
    })
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
                if let Some(Declaration::FunctionDeclaration(f)) = &e.declaration
                    && has_jsx_return(f)
                    && let Some(id) = &f.id
                {
                    return Some((id.name.as_str().to_string(), f));
                }
            }
            Statement::ExportDefaultDeclaration(e) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(f) = &e.declaration
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

/// The JSX expression an arrow returns, for either body form: `x => <jsx>` or
/// `x => { return <jsx>; }`.
fn arrow_jsx<'a>(arrow: &'a ArrowFunctionExpression<'a>) -> Option<&'a Expression<'a>> {
    if arrow.expression {
        if let Some(Statement::ExpressionStatement(es)) = arrow.body.statements.first() {
            let expr = unwrap_paren(&es.expression);
            if matches!(expr, Expression::JSXElement(_) | Expression::JSXFragment(_)) {
                return Some(expr);
            }
        }
        None
    } else {
        returned_jsx(&arrow.body)
    }
}

// ── Signal classification ───────────────────────────────────────────────────

struct ChildrenInfo {
    local: String,
    symbol: Option<SymbolId>,
}

struct Classified {
    by_symbol: HashMap<SymbolId, SignalId>,
    infos: Vec<SignalInfo>,
    decls: Vec<SignalDecl>,
    props: Vec<PropDecl>,
    children: Option<ChildrenInfo>,
    errors: Vec<String>,
}

/// Classify the component's reactive bindings into signals: destructured props
/// (first parameter) and top-level `$state`/`$derived`/`$ref` macros.
///
/// Two passes: first bind every signal's symbol → id (so a later initializer or
/// the view can reference any of them), then build the declarations with
/// `.value` injected into initializers/defaults.
fn classify<'a>(func: &'a Function<'a>, scoping: &Scoping, source: &str) -> Classified {
    enum Detail<'a> {
        Prop { local: String, attr: String, default: Option<&'a Expression<'a>> },
        Macro { arg: Option<&'a Argument<'a>> },
    }
    struct Pending<'a> {
        id: SignalId,
        name: String,
        kind: SignalKind,
        detail: Detail<'a>,
    }

    let mut by_symbol = HashMap::new();
    let mut pendings: Vec<Pending> = Vec::new();
    let mut errors = Vec::new();
    let mut children = None;

    // Pass 1a: destructured props from the first parameter.
    if let Some(param) = func.params.items.first() {
        match &param.pattern {
            BindingPattern::ObjectPattern(obj) => {
                for prop in &obj.properties {
                    let Some(attr) = prop.key.static_name() else {
                        errors.push("computed prop key not supported".into());
                        continue;
                    };
                    let (binding, default) = match &prop.value {
                        BindingPattern::BindingIdentifier(bi) => (Some(bi), None),
                        BindingPattern::AssignmentPattern(ap) => match &ap.left {
                            BindingPattern::BindingIdentifier(bi) => (Some(bi), Some(&ap.right)),
                            _ => (None, None),
                        },
                        _ => (None, None),
                    };
                    let Some(bi) = binding else {
                        errors.push(format!("nested prop pattern not supported: {attr}"));
                        continue;
                    };
                    let local = bi.name.as_str().to_string();
                    // `children` is the light-DOM slot (SPEC §4.5), not an
                    // observed attribute/signal.
                    if attr == "children" {
                        children = Some(ChildrenInfo { local, symbol: bi.symbol_id.get() });
                        continue;
                    }
                    let Some(symbol) = bi.symbol_id.get() else { continue };
                    let id = SignalId(pendings.len() as u32);
                    by_symbol.insert(symbol, id);
                    pendings.push(Pending {
                        id,
                        name: local.clone(),
                        kind: SignalKind::Prop,
                        detail: Detail::Prop { local, attr: attr.to_string(), default },
                    });
                }
                if obj.rest.is_some() {
                    errors.push("rest props (`...rest`) not supported yet".into());
                }
            }
            BindingPattern::BindingIdentifier(_) => {
                errors.push("direct `props` object not supported yet; destructure props".into());
            }
            _ => {}
        }
    }

    // Pass 1b: top-level macro declarations.
    if let Some(body) = func.body.as_deref() {
        for stmt in &body.statements {
            let Statement::VariableDeclaration(vd) = stmt else { continue };
            for d in &vd.declarations {
                let Some(Expression::CallExpression(call)) = &d.init else { continue };
                let Some(kind) = macro_kind(call) else { continue };
                let BindingPattern::BindingIdentifier(bi) = &d.id else { continue };
                let Some(symbol) = bi.symbol_id.get() else { continue };

                let id = SignalId(pendings.len() as u32);
                by_symbol.insert(symbol, id);
                pendings.push(Pending {
                    id,
                    name: bi.name.as_str().to_string(),
                    kind: kind.signal_kind(),
                    detail: Detail::Macro { arg: call.arguments.first() },
                });
            }
        }
    }

    // Pass 2: build declarations with `.value` injected (symbol set now complete).
    let mut infos = Vec::with_capacity(pendings.len());
    let mut decls = Vec::new();
    let mut props = Vec::new();
    for p in pendings {
        infos.push(SignalInfo { id: p.id, kind: p.kind.clone(), name: p.name.clone() });
        match p.detail {
            Detail::Prop { local, attr, default } => {
                let default = default.map(|e| inject_expr(source, scoping, &by_symbol, e).code);
                props.push(PropDecl { local, attr, default });
            }
            Detail::Macro { arg } => {
                let (init, init_is_fn) = match arg {
                    Some(arg) if !arg.is_spread() => {
                        (inject_arg(source, scoping, &by_symbol, arg).code, is_fn_argument(arg))
                    }
                    _ => (String::new(), false),
                };
                decls.push(SignalDecl { name: p.name, kind: p.kind, init, init_is_fn });
            }
        }
    }

    Classified { by_symbol, infos, decls, props, children, errors }
}

fn macro_kind(call: &CallExpression) -> Option<MacroKind> {
    let Expression::Identifier(id) = &call.callee else { return None };
    match id.name.as_str() {
        "$state" => Some(MacroKind::State),
        "$derived" => Some(MacroKind::Derived),
        "$ref" => Some(MacroKind::Ref),
        _ => None,
    }
}

fn is_fn_argument(arg: &Argument) -> bool {
    matches!(arg, Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_))
}

// ── `.value` injection ──────────────────────────────────────────────────────

/// Collects the end offsets of identifier references that resolve to signals,
/// so `.value` can be spliced in after each.
struct RefCollector<'r> {
    scoping: &'r Scoping,
    signals: &'r HashMap<SymbolId, SignalId>,
    ends: Vec<u32>,
    deps: Vec<SignalId>,
}

impl<'a> Visit<'a> for RefCollector<'_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if let Some(ref_id) = it.reference_id.get()
            && let Some(symbol) = self.scoping.get_reference(ref_id).symbol_id()
            && let Some(&sig) = self.signals.get(&symbol)
        {
            self.ends.push(it.span.end);
            if !self.deps.contains(&sig) {
                self.deps.push(sig);
            }
        }
    }
}

fn new_collector<'r>(
    scoping: &'r Scoping,
    signals: &'r HashMap<SymbolId, SignalId>,
) -> RefCollector<'r> {
    RefCollector { scoping, signals, ends: Vec::new(), deps: Vec::new() }
}

/// Splice `.value` into `source[span]` at each collected reference end.
fn splice(source: &str, span: Span, mut ends: Vec<u32>) -> String {
    let base = span.start as usize;
    let slice = &source[base..span.end as usize];
    ends.sort_unstable();
    let mut out = String::with_capacity(slice.len() + ends.len() * 6);
    let mut last = 0usize;
    for end in ends {
        let rel = end as usize - base;
        out.push_str(&slice[last..rel]);
        out.push_str(".value");
        last = rel;
    }
    out.push_str(&slice[last..]);
    out
}

fn inject_jsx(
    source: &str,
    scoping: &Scoping,
    signals: &HashMap<SymbolId, SignalId>,
    expr: &JSXExpression,
) -> ExprInfo {
    let mut rc = new_collector(scoping, signals);
    rc.visit_jsx_expression(expr);
    ExprInfo { code: splice(source, expr.span(), rc.ends), deps: rc.deps }
}

fn inject_arg(
    source: &str,
    scoping: &Scoping,
    signals: &HashMap<SymbolId, SignalId>,
    arg: &Argument,
) -> ExprInfo {
    let mut rc = new_collector(scoping, signals);
    rc.visit_argument(arg);
    ExprInfo { code: splice(source, arg.span(), rc.ends), deps: rc.deps }
}

fn inject_expr(
    source: &str,
    scoping: &Scoping,
    signals: &HashMap<SymbolId, SignalId>,
    expr: &Expression,
) -> ExprInfo {
    let mut rc = new_collector(scoping, signals);
    rc.visit_expression(expr);
    ExprInfo { code: splice(source, expr.span(), rc.ends), deps: rc.deps }
}

// ── View lowering ───────────────────────────────────────────────────────────

struct Lowerer<'s, 'r> {
    source: &'s str,
    scoping: &'r Scoping,
    /// Owned so list-item parameters can be scoped in/out during lowering.
    signals: HashMap<SymbolId, SignalId>,
    /// The `children` slot binding's symbol, if the component destructures it.
    children_symbol: Option<SymbolId>,
    exprs: ExprTable,
    errors: Vec<String>,
}

/// Sentinel id for a list-item parameter signal: it participates in `.value`
/// injection but is not a component-level signal (deps are codegen-irrelevant).
const ITEM_PARAM_SIGNAL: SignalId = SignalId(u32::MAX);

impl<'s, 'r> Lowerer<'s, 'r> {
    fn new(
        source: &'s str,
        scoping: &'r Scoping,
        signals: HashMap<SymbolId, SignalId>,
        children_symbol: Option<SymbolId>,
    ) -> Self {
        Self {
            source,
            scoping,
            signals,
            children_symbol,
            exprs: ExprTable::default(),
            errors: Vec::new(),
        }
    }

    /// True when `expr` is a bare reference to the `children` slot binding.
    fn is_children_ref(&self, expr: &JSXExpression) -> bool {
        let Some(target) = self.children_symbol else { return false };
        let JSXExpression::Identifier(id) = expr else { return false };
        let Some(ref_id) = id.reference_id.get() else { return false };
        self.scoping.get_reference(ref_id).symbol_id() == Some(target)
    }

    fn slice(&self, span: Span) -> &'s str {
        &self.source[span.start as usize..span.end as usize]
    }

    fn intern_jsx(&mut self, expr: &JSXExpression) -> ExpressionId {
        let info = inject_jsx(self.source, self.scoping, &self.signals, expr);
        self.exprs.intern(info)
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
                _ if self.is_children_ref(&c.expression) => Some(ViewNode::Children),
                _ => self
                    .try_lower_list(&c.expression)
                    .or_else(|| Some(ViewNode::Dynamic { expr: self.intern_jsx(&c.expression) })),
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
                    if name == "ref" {
                        self.errors.push("ref attribute not supported yet".into());
                        continue;
                    }
                    // `key` is list-reconciliation metadata, not a DOM attribute
                    // (SPEC §5.4.4); handled by list lowering, ignored elsewhere.
                    if name == "key" {
                        continue;
                    }
                    let value = match &attr.value {
                        // Valueless attribute (`<input disabled />`): present, no value.
                        None => PropValue::Static(String::new()),
                        Some(JSXAttributeValue::StringLiteral(s)) => {
                            PropValue::Static(s.value.as_str().to_string())
                        }
                        Some(JSXAttributeValue::ExpressionContainer(c)) => match &c.expression {
                            JSXExpression::EmptyExpression(_) => PropValue::Static(String::new()),
                            _ => PropValue::Dynamic(self.intern_jsx(&c.expression)),
                        },
                        // JSX-valued props (`foo=<El/>`): kept as static source text.
                        Some(JSXAttributeValue::Element(e)) => {
                            PropValue::Dynamic(self.intern_static(e.span))
                        }
                        Some(JSXAttributeValue::Fragment(f)) => {
                            PropValue::Dynamic(self.intern_static(f.span))
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

    /// Intern a span verbatim (no reactivity), for JSX-valued props.
    fn intern_static(&mut self, span: Span) -> ExpressionId {
        let code = self.slice(span).to_string();
        self.exprs.intern(ExprInfo { code, deps: Vec::new() })
    }

    /// Lower `{ array.map(cb) }` into a `List` node (SPEC §5.4.4). Returns `None`
    /// for anything that isn't a recognized map-call so the caller falls back to
    /// a plain dynamic hole.
    fn try_lower_list(&mut self, expr: &JSXExpression) -> Option<ViewNode> {
        let JSXExpression::CallExpression(call) = expr else { return None };
        let Expression::StaticMemberExpression(member) = &call.callee else { return None };
        if member.property.name != "map" {
            return None;
        }
        let Some(Argument::ArrowFunctionExpression(arrow)) = call.arguments.first() else {
            return None;
        };
        // Item parameter (required, simple identifier) + optional index parameter.
        let item_bi = match arrow.params.items.first().map(|p| &p.pattern) {
            Some(BindingPattern::BindingIdentifier(bi)) => bi,
            _ => return None,
        };
        let item_param = item_bi.name.as_str().to_string();
        let item_symbol = item_bi.symbol_id.get();
        let index_param = match arrow.params.items.get(1).map(|p| &p.pattern) {
            Some(BindingPattern::BindingIdentifier(bi)) => Some(bi.name.as_str().to_string()),
            _ => None,
        };

        let body_jsx = arrow_jsx(arrow)?;

        // Source = the chain before `.map`, with outer signals `.value`-injected.
        let source_info = inject_expr(self.source, self.scoping, &self.signals, &member.object);
        let source = self.exprs.intern(source_info);

        // Key is evaluated against the *plain* item, so intern it before the item
        // parameter becomes a signal.
        let key = self.extract_key(body_jsx);

        // Scope the item parameter in as a signal while lowering the item view.
        let restore = item_symbol.map(|s| (s, self.signals.insert(s, ITEM_PARAM_SIGNAL)));
        let item = self.lower_root(body_jsx)?;
        if let Some((s, prev)) = restore {
            match prev {
                Some(v) => self.signals.insert(s, v),
                None => self.signals.remove(&s),
            };
        }

        Some(ViewNode::List {
            source,
            item_param,
            index_param,
            item: Box::new(item),
            key,
        })
    }

    /// Intern the `key={…}` expression from a list item's root element, if any.
    fn extract_key(&mut self, body_jsx: &Expression) -> Option<ExpressionId> {
        let Expression::JSXElement(el) = unwrap_paren(body_jsx) else { return None };
        for item in &el.opening_element.attributes {
            let JSXAttributeItem::Attribute(attr) = item else { continue };
            let JSXAttributeName::Identifier(id) = &attr.name else { continue };
            if id.name != "key" {
                continue;
            }
            return match &attr.value {
                Some(JSXAttributeValue::ExpressionContainer(c)) => Some(self.intern_jsx(&c.expression)),
                Some(JSXAttributeValue::StringLiteral(s)) => {
                    Some(self.intern_static(s.span))
                }
                _ => None,
            };
        }
        None
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

/// Normalize JSX text per the JSX whitespace rules (matching Babel's
/// `cleanJSXElementLiteralChild`): whitespace touching a newline is trimmed,
/// newlines collapse to a single space, blank lines are dropped, and tabs
/// become spaces — but significant whitespace on a single line (e.g. the space
/// in `Hello {name}`) is preserved. Whitespace-only text between tags yields "".
fn normalize_jsx_text(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();

    let last_non_empty = lines
        .iter()
        .rposition(|line| line.bytes().any(|b| b != b' ' && b != b'\t'))
        .unwrap_or(0);

    let mut out = String::new();
    let count = lines.len();
    for (i, line) in lines.iter().enumerate() {
        let mut piece = line.replace('\t', " ");
        if i != 0 {
            piece = piece.trim_start_matches(' ').to_string();
        }
        if i != count - 1 {
            piece = piece.trim_end_matches(' ').to_string();
        }
        if piece.is_empty() {
            continue;
        }
        out.push_str(&piece);
        if i != last_non_empty {
            out.push(' ');
        }
    }
    out
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
        // `name` is not a signal here, so no `.value` is injected.
        assert_eq!(lowered.exprs.code(*expr), Some("name"));
        assert_eq!(lowered.exprs.deps(*expr), Some(&[][..]));
    }

    #[test]
    fn classifies_state_and_injects_value() {
        let lowered = lower(
            "export function Counter() { let count = $state(0); return <p>{count}</p>; }",
        );
        // Signal classified.
        assert_eq!(lowered.signals_len(), 1);
        assert_eq!(lowered.decls[0].name, "count");
        assert_eq!(lowered.decls[0].kind, SignalKind::State);
        assert_eq!(lowered.decls[0].init, "0");
        // The hole references the signal, so `.value` is injected and a dep recorded.
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::Dynamic { expr } = &children[0] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("count.value"));
        assert_eq!(lowered.exprs.deps(*expr), Some(&[SignalId(0)][..]));
    }

    #[test]
    fn injects_value_in_event_handler() {
        let lowered = lower(
            "export function Counter() { let count = $state(0); return <button onclick={() => count++}>{count}</button>; }",
        );
        let ViewNode::Element { props, .. } = &lowered.ir.view else { panic!() };
        let PropValue::Dynamic(expr) = props[0].value else { panic!("expected dynamic onclick") };
        assert_eq!(lowered.exprs.code(expr), Some("() => count.value++"));
    }

    #[test]
    fn derived_wraps_and_injects() {
        let lowered = lower(
            "export function C() { let n = $state(2); let d = $derived(n * 2); return <p>{d}</p>; }",
        );
        let derived = lowered.decls.iter().find(|d| d.name == "d").unwrap();
        assert_eq!(derived.kind, SignalKind::Derived);
        assert_eq!(derived.init, "n.value * 2");
        assert!(!derived.init_is_fn);
    }

    #[test]
    fn classifies_destructured_props() {
        let lowered = lower(
            "export function Greet({ name, title: t = \"Mr\" }) { return <div>{name}{t}</div>; }",
        );
        assert_eq!(lowered.props.len(), 2);
        assert_eq!(lowered.props[0], PropDecl { local: "name".into(), attr: "name".into(), default: None });
        assert_eq!(
            lowered.props[1],
            PropDecl { local: "t".into(), attr: "title".into(), default: Some("\"Mr\"".into()) }
        );
        // Both prop refs are reactive (signals), so `.value` is injected.
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::Dynamic { expr } = &children[0] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("name.value"));
        let ViewNode::Dynamic { expr } = &children[1] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("t.value"));
    }

    #[test]
    fn lowers_children_slot() {
        let lowered =
            lower("export function Wrap({ children }) { return <div>{children}</div>; }");
        // `children` is the slot, not a normal prop/observed attribute.
        assert!(lowered.props.is_empty());
        assert_eq!(lowered.children_local.as_deref(), Some("children"));
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        assert_eq!(children[0], ViewNode::Children);
    }

    #[test]
    fn reports_rest_props_unsupported() {
        let lowered = lower("export function C({ a, ...rest }) { return <p>{a}</p>; }");
        assert!(lowered.errors.iter().any(|e| e.contains("rest props")));
    }

    #[test]
    fn lowers_keyed_list() {
        let lowered = lower(
            "export function L() { let items = $state([]); return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>; }",
        );
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::List { source, item_param, index_param, item, key } = &children[0] else {
            panic!("expected list, got {:?}", children[0]);
        };
        assert_eq!(item_param, "i");
        assert_eq!(index_param, &None);
        // Source: outer signal `.value`-injected.
        assert_eq!(lowered.exprs.code(*source), Some("items.value"));
        // Key: evaluated against the plain item — no `.value`.
        assert_eq!(lowered.exprs.code(key.expect("key present")), Some("i.id"));
        // Item view: the callback param is a signal, so `.value` is injected.
        let ViewNode::Element { tag, children: li, .. } = &**item else { panic!() };
        assert_eq!(tag, "li");
        let ViewNode::Dynamic { expr } = &li[0] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("i.value.name"));
    }

    #[test]
    fn distinguishes_component_and_dynamic_prop() {
        let lowered = lower("export function App() { return <Foo bar={1 + 2} />; }");
        let ViewNode::Component { name, props, .. } = &lowered.ir.view else {
            panic!("expected component, got {:?}", lowered.ir.view);
        };
        assert_eq!(name, "Foo");
        let PropValue::Dynamic(expr) = props[0].value else { panic!("expected dynamic prop") };
        assert_eq!(lowered.exprs.code(expr), Some("1 + 2"));
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

    #[test]
    fn preserves_significant_space_before_hole() {
        let lowered = lower("export function App() { return <div>Hello {name}</div>; }");
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        assert_eq!(children.len(), 2);
        assert_eq!(children[0], ViewNode::Text("Hello ".into()), "trailing space must survive");
        assert!(matches!(children[1], ViewNode::Dynamic { .. }));
    }

    #[test]
    fn preserves_text_between_holes() {
        let lowered = lower("export function App() { return <p>{a} and {b}</p>; }");
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        assert_eq!(children.len(), 3);
        assert_eq!(children[1], ViewNode::Text(" and ".into()));
    }

    #[test]
    fn jsx_whitespace_rules() {
        // Single line: internal whitespace preserved, edges untouched.
        assert_eq!(normalize_jsx_text("Hello "), "Hello ");
        assert_eq!(normalize_jsx_text("a  b"), "a  b");
        // Newline-adjacent whitespace trimmed; newline → single space.
        assert_eq!(normalize_jsx_text("line one\nline two"), "line one line two");
        assert_eq!(normalize_jsx_text("\n  hello\n  world\n"), "hello world");
        // Whitespace-only between tags → empty.
        assert_eq!(normalize_jsx_text("\n  "), "");
        // Tabs become spaces.
        assert_eq!(normalize_jsx_text("a\tb"), "a b");
    }

    impl Lowered {
        fn signals_len(&self) -> usize {
            self.ir.signals.len()
        }
    }
}
