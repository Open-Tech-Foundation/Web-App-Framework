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
//!   body is top-level macro declarations / `$effect` calls + a `return <jsx>`.
//! - `$signal` external bridge, member-expression component names, and spreads
//!   are follow-ups.

use std::collections::HashMap;

use oxc::ast::ast::{
    Argument, ArrowFunctionExpression, BindingPattern, CallExpression, Declaration, Expression,
    ExportDefaultDeclarationKind, FormalParameters, Function, FunctionBody, IdentifierReference,
    ImportDeclarationSpecifier, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild,
    JSXElement, JSXElementName, JSXExpression, JSXFragment, Program, StaticMemberExpression,
    Statement, VariableDeclaration,
};
use oxc::ast_visit::{walk, Visit};
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

/// One item of a component/page body, in source order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BodyItem {
    /// A reactive signal declaration (`$state`/`$derived`/`$ref`).
    Signal(SignalDecl),
    /// A preserved statement, verbatim with `.value` injected (local consts,
    /// helper functions, event handlers, etc.).
    Raw(String),
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

/// A component prop, from either destructuring (`function C({ name: local =
/// default })`) or props-object discovery (`function C(props)` + `props.name`).
///
/// `attr` is the public attribute/property name (observed + synced); `local` is
/// the in-body binding the view references (equal to `attr` for the props-object
/// form, which references `props.attr` instead). Both are reactive signal-backed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropDecl {
    pub local: String,
    pub attr: String,
    /// Default initializer source, applied when the attribute is absent.
    pub default: Option<String>,
}

/// A `...rest` prop (`{ a, ...others }`): a static snapshot of the element's
/// attributes minus the explicitly named props (SPEC §2.7). Non-reactive — the
/// rest object captures values once at connect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestProp {
    pub name: String,
    /// Named prop attributes to exclude from the snapshot.
    pub exclude: Vec<String>,
}

/// A nested destructuring pattern on a prop (`{ user: { name } }`). Destructuring
/// evaluates eagerly, so the inner bindings are captured as a one-time snapshot
/// of the prop's value at connect — non-reactive, matching JS / Solid / Svelte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropSnapshot {
    /// The inner pattern source verbatim, e.g. `{ name, age: a = 1 }` or `[first]`.
    pub pattern: String,
    /// The outer prop's local binding (its signal alias) the snapshot reads from.
    pub source: String,
    /// Null-safe fallback for the destructure: `{}` (object) or `[]` (array).
    pub empty: &'static str,
}

/// The output of Stage 3 for one component.
#[derive(Debug, Clone, PartialEq)]
pub struct Lowered {
    pub ir: ComponentIR,
    /// Whether to emit this as a page/layout factory (vs. a Custom Element). Set
    /// for the default export of a page module; co-located components are `false`.
    pub is_page: bool,
    /// Whether this component was the module's `export default`. In a component
    /// module its Custom Element class becomes the module's default export, so a
    /// page's `import Counter from "../components/Counter"` resolves.
    pub is_default_export: bool,
    /// The component's function name (`function Counter` → `Counter`), used to
    /// derive the Custom Element tag/class even for `export default` — so a page's
    /// `<Counter/>` (tag from the JSX name) matches the registered `web-counter`.
    /// Falls back to the export name for anonymous components.
    pub name: String,
    /// Verbatim top-level `import` declarations from the source module (excluding
    /// `@opentf/web`), preserved so the bundler pulls in dependencies (e.g. composed
    /// components that self-register as Custom Elements) — re-emitted ahead of the
    /// runtime import.
    pub imports: Vec<String>,
    /// Named specifiers the source imports from `@opentf/web` (e.g. `signal`,
    /// `router`, `Link`), merged into the single generated runtime import.
    pub runtime_imports: Vec<String>,
    pub exprs: ExprTable,
    /// Signal declarations (`$state`/`$derived`/`$ref`) to emit before the view.
    pub decls: Vec<SignalDecl>,
    /// The component/page body in source order: signal declarations interleaved
    /// with preserved verbatim statements (local data, helper functions, event
    /// handlers — `.value`-injected). Drives in-order emission before the view.
    pub body: Vec<BodyItem>,
    /// Component props (the Custom Element's observed signals), from either
    /// destructuring or props-object discovery.
    pub props: Vec<PropDecl>,
    /// The local name of the props object when the component uses the
    /// props-object form (`function C(props)`); `None` for destructured props.
    /// Drives a single `const props = this._props;` alias instead of per-key.
    pub props_object: Option<String>,
    /// For a page/layout factory: the plain props parameter name (`function
    /// Page(props)`), so codegen emits `function (props) { … }`. `None` when the
    /// page declares no parameter.
    pub page_param: Option<String>,
    /// The `...rest` prop, if the destructuring uses one.
    pub rest: Option<RestProp>,
    /// One-time snapshots for nested destructuring patterns.
    pub prop_snapshots: Vec<PropSnapshot>,
    /// Top-level `$effect(cb)` callbacks (`.value`-injected source), to run as
    /// effects with their disposers collected for cleanup (SPEC §3.2).
    pub effects: Vec<String>,
    /// Top-level `$expose(obj)` arguments (`.value`-injected source); each is
    /// `Object.assign`ed onto the element so its props become public (SPEC §3.2).
    pub exposes: Vec<String>,
    /// Top-level `onMount(cb)` callbacks (`.value`-injected source); run after the
    /// view is inserted into the DOM, their returned disposer collected for cleanup.
    pub on_mounts: Vec<String>,
    /// Top-level `onCleanup(cb)` callbacks (`.value`-injected source); registered as
    /// teardown to run when the component/page is removed.
    pub on_cleanups: Vec<String>,
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
pub fn lower_component<'a>(
    module: &str,
    program: &'a Program<'a>,
    source: &'a str,
    is_page: bool,
) -> Option<Lowered> {
    let resolved = crate::semantic::resolve(program);
    let scoping = resolved.semantic.scoping();
    let (imports, runtime_imports) = collect_imports(program, source);
    let (export, func) = find_component(program)?;
    lower_one(module, &export, func, scoping, source, is_page, &imports, &runtime_imports, is_page, true)
}

/// A whole `.jsx` module: every component it declares (the page factory plus any
/// co-located Custom Elements) and the preserved top-level statements between them.
pub struct LoweredModule {
    /// Each component, in source order. Exactly the default export is a page when
    /// `is_page_module`; the rest are Custom Elements.
    pub components: Vec<Lowered>,
    /// Preserved top-level statements (helper data, module-level stores).
    pub module_stmts: Vec<String>,
}

/// Lower an entire module: all JSX-returning top-level functions become
/// components (the default export is the page when `is_page_module`), and other
/// top-level statements (non-import, non-component) are preserved verbatim so the
/// components' references resolve.
pub fn lower_module<'a>(
    module: &str,
    program: &'a Program<'a>,
    source: &'a str,
    is_page_module: bool,
) -> Option<LoweredModule> {
    let resolved = crate::semantic::resolve(program);
    let scoping = resolved.semantic.scoping();
    let (imports, runtime_imports) = collect_imports(program, source);

    let mut components = Vec::new();
    let mut module_stmts = Vec::new();
    for stmt in &program.body {
        if let Some((export, func, is_default)) = component_of(stmt) {
            let role = is_page_module && is_default;
            if let Some(lowered) =
                lower_one(module, &export, func, scoping, source, role, &imports, &runtime_imports, role, is_default)
            {
                components.push(lowered);
            }
        } else if !matches!(stmt, Statement::ImportDeclaration(_)) {
            // Preserve helper data / module-level stores verbatim.
            module_stmts.push(slice_span(source, stmt.span()));
        }
    }
    if components.is_empty() {
        return None;
    }
    Some(LoweredModule { components, module_stmts })
}

/// Lower one component function to its `Lowered` facts.
#[allow(clippy::too_many_arguments)]
fn lower_one<'a>(
    module: &str,
    export: &str,
    callable: Callable<'a>,
    scoping: &Scoping,
    source: &'a str,
    is_page: bool,
    imports: &[String],
    runtime_imports: &[String],
    is_page_role: bool,
    is_default_export: bool,
) -> Option<Lowered> {
    callable.body()?;
    let name = callable.id().unwrap_or_else(|| export.to_string());

    let classified = classify(callable, scoping, source, is_page);

    let children_symbol = classified.children.as_ref().and_then(|c| c.symbol);
    let children_local = classified.children.map(|c| c.local);

    let jsx = callable.jsx()?;
    let mut lowerer = Lowerer::new(
        source,
        scoping,
        classified.by_symbol,
        children_symbol,
        classified.props_symbol,
        classified.page_param.clone(),
    );
    let view = lowerer.lower_root(jsx)?;

    let mut errors = classified.errors;
    errors.extend(lowerer.errors);

    let ir = ComponentIR {
        id: ComponentId::new(module, export.to_string()),
        view,
        signals: classified.infos,
        imports: Vec::new(),
        exports: Vec::new(),
    };
    Some(Lowered {
        ir,
        is_page: is_page_role,
        is_default_export,
        name,
        imports: imports.to_vec(),
        runtime_imports: runtime_imports.to_vec(),
        exprs: lowerer.exprs,
        decls: classified.decls,
        body: classified.body,
        props: classified.props,
        props_object: classified.props_object,
        page_param: classified.page_param,
        rest: classified.rest,
        prop_snapshots: classified.prop_snapshots,
        effects: classified.effects,
        exposes: classified.exposes,
        on_mounts: classified.on_mounts,
        on_cleanups: classified.on_cleanups,
        children_local,
        errors,
    })
}

/// Collect the module's top-level imports. `@opentf/web` named specifiers are
/// returned separately (merged into the single generated runtime import); compiler
/// macros are dropped; all other imports are preserved verbatim.
fn collect_imports(program: &Program, source: &str) -> (Vec<String>, Vec<String>) {
    let mut imports = Vec::new();
    let mut runtime_imports = Vec::new();
    for stmt in &program.body {
        let Statement::ImportDeclaration(decl) = stmt else { continue };
        if decl.source.value != "@opentf/web" {
            imports.push(slice_span(source, decl.span));
            continue;
        }
        let mut verbatim = false;
        if let Some(specifiers) = &decl.specifiers {
            for spec in specifiers {
                match spec {
                    ImportDeclarationSpecifier::ImportSpecifier(s) => {
                        let imported = s.imported.name();
                        if is_macro_name(&imported) {
                            continue;
                        }
                        let local = s.local.name.as_str();
                        runtime_imports.push(if imported == local {
                            local.to_string()
                        } else {
                            format!("{imported} as {local}")
                        });
                    }
                    _ => verbatim = true,
                }
            }
        }
        if verbatim {
            imports.push(slice_span(source, decl.span));
        }
    }
    (imports, runtime_imports)
}

/// If `stmt` declares a JSX-returning function component, return its export name,
/// the function, and whether it is the default export.
fn component_of<'a>(stmt: &'a Statement<'a>) -> Option<(String, Callable<'a>, bool)> {
    match stmt {
        Statement::FunctionDeclaration(f) if has_jsx_return(f) => {
            let name = f.id.as_ref()?.name.as_str().to_string();
            Some((name, Callable::Function(f), false))
        }
        // `const Icon = () => <svg/>` (or a function expression).
        Statement::VariableDeclaration(vd) => arrow_component_of(vd).map(|(n, c)| (n, c, false)),
        Statement::ExportNamedDeclaration(e) => match &e.declaration {
            Some(Declaration::FunctionDeclaration(f)) if has_jsx_return(f) => {
                let id = f.id.as_ref()?;
                Some((id.name.as_str().to_string(), Callable::Function(f), false))
            }
            Some(Declaration::VariableDeclaration(vd)) => {
                arrow_component_of(vd).map(|(n, c)| (n, c, false))
            }
            _ => None,
        },
        Statement::ExportDefaultDeclaration(e) => match &e.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(f) if has_jsx_return(f) => {
                Some(("default".to_string(), Callable::Function(f), true))
            }
            ExportDefaultDeclarationKind::ArrowFunctionExpression(a) if arrow_jsx(a).is_some() => {
                Some(("default".to_string(), Callable::Arrow(a), true))
            }
            _ => None,
        },
        _ => None,
    }
}

/// Find the first component (function declaration or arrow) and its export name.
/// `export default function` yields the export name `default`.
fn find_component<'a>(program: &'a Program<'a>) -> Option<(String, Callable<'a>)> {
    for stmt in &program.body {
        if let Some((name, callable, _)) = component_of(stmt) {
            return Some((name, callable));
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
            // A component returns JSX directly (`<div/>`) or embedded in an
            // expression (`cond ? <a/> : <b/>`) — SPEC §2.1.
            let unwrapped = unwrap_paren(arg);
            if has_jsx_expr(unwrapped) {
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
            if has_jsx_expr(expr) {
                return Some(expr);
            }
        }
        None
    } else {
        returned_jsx(&arrow.body)
    }
}

/// A component definition's callable form: a `function` declaration/expression or
/// an arrow function. Both expose the same params/body/JSX the lowerer needs, so
/// `function C() {…}` and `const C = () => …` lower identically (SPEC §2.1).
#[derive(Clone, Copy)]
enum Callable<'a> {
    Function(&'a Function<'a>),
    Arrow(&'a ArrowFunctionExpression<'a>),
}

impl<'a> Callable<'a> {
    fn params(&self) -> &'a FormalParameters<'a> {
        match self {
            Callable::Function(f) => &f.params,
            Callable::Arrow(a) => &a.params,
        }
    }

    fn body(&self) -> Option<&'a FunctionBody<'a>> {
        match self {
            Callable::Function(f) => f.body.as_deref(),
            Callable::Arrow(a) => Some(&a.body),
        }
    }

    /// The view JSX this component returns, if any.
    fn jsx(&self) -> Option<&'a Expression<'a>> {
        match self {
            Callable::Function(f) => f.body.as_deref().and_then(returned_jsx),
            Callable::Arrow(a) => arrow_jsx(a),
        }
    }

    /// The function's own name (`function Counter`), if it has one.
    fn id(&self) -> Option<String> {
        match self {
            Callable::Function(f) => f.id.as_ref().map(|id| id.name.as_str().to_string()),
            Callable::Arrow(_) => None,
        }
    }

    fn has_jsx(&self) -> bool {
        self.jsx().is_some()
    }
}

/// If `decl` declares exactly one `const NAME = () => <jsx>` (or function
/// expression) arrow component, return its binding name and callable.
fn arrow_component_of<'a>(
    decl: &'a VariableDeclaration<'a>,
) -> Option<(String, Callable<'a>)> {
    if decl.declarations.len() != 1 {
        return None;
    }
    let d = &decl.declarations[0];
    let BindingPattern::BindingIdentifier(bi) = &d.id else {
        return None;
    };
    let callable = match &d.init {
        Some(Expression::ArrowFunctionExpression(a)) => Callable::Arrow(a),
        Some(Expression::FunctionExpression(f)) => Callable::Function(f),
        _ => return None,
    };
    if !callable.has_jsx() {
        return None;
    }
    Some((bi.name.as_str().to_string(), callable))
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
    body: Vec<BodyItem>,
    props: Vec<PropDecl>,
    /// The props-object binding (`function C(props)`): its symbol drives
    /// First-Access `.value` injection; its name drives the codegen alias.
    props_symbol: Option<SymbolId>,
    props_object: Option<String>,
    /// The plain props parameter name for a page/layout factory, if declared.
    page_param: Option<String>,
    rest: Option<RestProp>,
    prop_snapshots: Vec<PropSnapshot>,
    effects: Vec<String>,
    exposes: Vec<String>,
    on_mounts: Vec<String>,
    on_cleanups: Vec<String>,
    children: Option<ChildrenInfo>,
    errors: Vec<String>,
}

/// Classify the component's reactive bindings into signals: destructured props
/// (first parameter) and top-level `$state`/`$derived`/`$ref` macros.
///
/// Two passes: first bind every signal's symbol → id (so a later initializer or
/// the view can reference any of them), then build the declarations with
/// `.value` injected into initializers/defaults.
fn classify<'a>(callable: Callable<'a>, scoping: &Scoping, source: &str, is_page: bool) -> Classified {
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
    let mut props_symbol = None;
    let mut props_object = None;
    let mut rest_prop = None;
    let mut snapshots: Vec<PropSnapshot> = Vec::new();
    let mut named_keys: Vec<String> = Vec::new();
    let mut page_param = None;

    // Pages/layouts take a plain props object (`{ params, query, children }`)
    // supplied by the router — no observed signals and no `.value` injection. We
    // only record the parameter name for the factory signature; `props.children`
    // and `props.params.*` then lower as ordinary (non-reactive) accesses.
    if is_page {
        if let Some(BindingPattern::BindingIdentifier(bi)) =
            callable.params().items.first().map(|p| &p.pattern)
        {
            page_param = Some(bi.name.as_str().to_string());
        }
    } else if let Some(param) = callable.params().items.first() {
        // Pass 1a: destructured props from the first parameter.
        match &param.pattern {
            BindingPattern::ObjectPattern(obj) => {
                for prop in &obj.properties {
                    let Some(attr) = prop.key.static_name() else {
                        errors.push("computed prop key not supported".into());
                        continue;
                    };
                    // Unwrap an optional default (`= …`) to reach the binding.
                    let (pattern, default) = match &prop.value {
                        BindingPattern::AssignmentPattern(ap) => (&ap.left, Some(&ap.right)),
                        other => (other, None),
                    };
                    match pattern {
                        BindingPattern::BindingIdentifier(bi) => {
                            let local = bi.name.as_str().to_string();
                            // `children` is the light-DOM slot (SPEC §4.5), not an
                            // observed attribute/signal.
                            if attr == "children" {
                                children = Some(ChildrenInfo { local, symbol: bi.symbol_id.get() });
                                continue;
                            }
                            let Some(symbol) = bi.symbol_id.get() else { continue };
                            named_keys.push(attr.to_string());
                            let id = SignalId(pendings.len() as u32);
                            by_symbol.insert(symbol, id);
                            pendings.push(Pending {
                                id,
                                name: local.clone(),
                                kind: SignalKind::Prop,
                                detail: Detail::Prop { local, attr: attr.to_string(), default },
                            });
                        }
                        // Nested pattern (`{ user: { name } }`): observe the outer
                        // key as a signal, snapshot the inner bindings once.
                        BindingPattern::ObjectPattern(_) | BindingPattern::ArrayPattern(_) => {
                            named_keys.push(attr.to_string());
                            let id = SignalId(pendings.len() as u32);
                            pendings.push(Pending {
                                id,
                                name: attr.to_string(),
                                kind: SignalKind::Prop,
                                detail: Detail::Prop {
                                    local: attr.to_string(),
                                    attr: attr.to_string(),
                                    default: None,
                                },
                            });
                            let (src, empty) = match pattern {
                                BindingPattern::ObjectPattern(o) => (slice_span(source, o.span), "{}"),
                                BindingPattern::ArrayPattern(a) => (slice_span(source, a.span), "[]"),
                                _ => unreachable!(),
                            };
                            snapshots.push(PropSnapshot {
                                pattern: src,
                                source: attr.to_string(),
                                empty,
                            });
                        }
                        _ => errors.push(format!("unsupported prop pattern: {attr}")),
                    }
                }
                if let Some(rest) = &obj.rest {
                    match &rest.argument {
                        BindingPattern::BindingIdentifier(bi) => {
                            rest_prop = Some(RestProp {
                                name: bi.name.as_str().to_string(),
                                exclude: named_keys.clone(),
                            });
                        }
                        _ => errors.push("rest prop must be a simple identifier".into()),
                    }
                }
            }
            BindingPattern::BindingIdentifier(bi) => {
                // Props-object form (`function C(props)`): discover the keys used
                // as `props.key` across the component (SPEC §2.8) — each becomes
                // an observed signal; `props.children` is the light-DOM slot.
                if let Some(symbol) = bi.symbol_id.get()
                    && let Some(body) = callable.body()
                {
                    props_symbol = Some(symbol);
                    props_object = Some(bi.name.as_str().to_string());
                    let mut keys = PropsKeyCollector { scoping, props_symbol: symbol, keys: Vec::new(), has_children: false };
                    keys.visit_function_body(body);
                    if keys.has_children {
                        children = Some(ChildrenInfo { local: "__children".into(), symbol: None });
                    }
                    for key in keys.keys {
                        let id = SignalId(pendings.len() as u32);
                        pendings.push(Pending {
                            id,
                            name: key.clone(),
                            kind: SignalKind::Prop,
                            detail: Detail::Prop { local: key.clone(), attr: key, default: None },
                        });
                    }
                }
            }
            _ => {}
        }
    }

    // Pass 1b: top-level macro declarations and `$effect`/`$expose` statements.
    let mut effect_args: Vec<&Argument> = Vec::new();
    let mut expose_args: Vec<&Argument> = Vec::new();
    let mut mount_args: Vec<&Argument> = Vec::new();
    let mut cleanup_args: Vec<&Argument> = Vec::new();
    if let Some(body) = callable.body() {
        for stmt in &body.statements {
            match stmt {
                Statement::VariableDeclaration(vd) => {
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
                Statement::ExpressionStatement(es) => {
                    if let Expression::CallExpression(call) = &es.expression
                        && let Some(arg) = call.arguments.first()
                        && !arg.is_spread()
                    {
                        if is_effect_call(call) {
                            effect_args.push(arg);
                        } else if is_expose_call(call) {
                            expose_args.push(arg);
                        } else if is_callee(call, "onMount") {
                            mount_args.push(arg);
                        } else if is_callee(call, "onCleanup") {
                            cleanup_args.push(arg);
                        }
                    }
                }
                _ => {}
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
                let default = default.map(|e| inject_expr(source, scoping, &by_symbol, props_symbol, e).code);
                props.push(PropDecl { local, attr, default });
            }
            Detail::Macro { arg } => {
                let (init, init_is_fn) = match arg {
                    Some(arg) if !arg.is_spread() => {
                        (inject_arg(source, scoping, &by_symbol, props_symbol, arg).code, is_fn_argument(arg))
                    }
                    _ => (String::new(), false),
                };
                decls.push(SignalDecl { name: p.name, kind: p.kind, init, init_is_fn });
            }
        }
    }

    // `$effect`/`$expose` arguments: inject `.value` now the symbol set is complete.
    let effects = effect_args
        .into_iter()
        .map(|arg| inject_arg(source, scoping, &by_symbol, props_symbol, arg).code)
        .collect();
    let exposes = expose_args
        .into_iter()
        .map(|arg| inject_arg(source, scoping, &by_symbol, props_symbol, arg).code)
        .collect();
    let on_mounts = mount_args
        .into_iter()
        .map(|arg| inject_arg(source, scoping, &by_symbol, props_symbol, arg).code)
        .collect();
    let on_cleanups = cleanup_args
        .into_iter()
        .map(|arg| inject_arg(source, scoping, &by_symbol, props_symbol, arg).code)
        .collect();

    // Ordered body: interleave signal declarations with preserved statements
    // (local data, helper functions, event handlers) so the view's references
    // resolve. Signals are consumed in source order from `decls`.
    let mut body = Vec::new();
    let mut decl_iter = decls.iter();
    if let Some(fbody) = callable.body() {
        for stmt in &fbody.statements {
            match stmt {
                // The returned JSX becomes the view, not a statement.
                Statement::ReturnStatement(_) => {}
                // An expression-bodied arrow's JSX (`() => <div/>`) is the view too.
                Statement::ExpressionStatement(es) if has_jsx_expr(unwrap_paren(&es.expression)) => {}
                // `$state`/`$derived`/`$ref` declarations → signal items (in order).
                Statement::VariableDeclaration(vd) if is_macro_decl(vd) => {
                    for d in &vd.declarations {
                        if matches!(&d.init, Some(Expression::CallExpression(c)) if macro_kind(c).is_some())
                            && let Some(decl) = decl_iter.next()
                        {
                            body.push(BodyItem::Signal(decl.clone()));
                        }
                    }
                }
                // `$effect`/`$expose`/`onMount`/`onCleanup` are collected separately.
                Statement::ExpressionStatement(es) if is_lifecycle_stmt(es) => {}
                // Everything else is preserved verbatim with `.value` injected.
                other => body.push(BodyItem::Raw(inject_stmt(
                    source,
                    scoping,
                    &by_symbol,
                    props_symbol,
                    other,
                ))),
            }
        }
    }

    Classified {
        by_symbol,
        infos,
        decls,
        body,
        props,
        props_symbol,
        props_object,
        page_param,
        rest: rest_prop,
        prop_snapshots: snapshots,
        effects,
        exposes,
        on_mounts,
        on_cleanups,
        children,
        errors,
    }
}

fn is_effect_call(call: &CallExpression) -> bool {
    matches!(&call.callee, Expression::Identifier(id) if id.name == "$effect")
}

/// Whether a variable declaration introduces a reactive signal (`$state`/
/// `$derived`/`$ref` initializer) — those become signal items, not raw statements.
fn is_macro_decl(vd: &oxc::ast::ast::VariableDeclaration) -> bool {
    vd.declarations.iter().any(|d| {
        matches!(&d.init, Some(Expression::CallExpression(c)) if macro_kind(c).is_some())
    })
}

/// Whether an expression statement is a lifecycle/reactive macro call
/// (`$effect`/`$expose`/`onMount`/`onCleanup`) — collected, not preserved raw.
fn is_lifecycle_stmt(es: &oxc::ast::ast::ExpressionStatement) -> bool {
    matches!(&es.expression, Expression::CallExpression(call)
        if is_effect_call(call)
            || is_expose_call(call)
            || is_callee(call, "onMount")
            || is_callee(call, "onCleanup"))
}

fn is_expose_call(call: &CallExpression) -> bool {
    matches!(&call.callee, Expression::Identifier(id) if id.name == "$expose")
}

/// Whether `call`'s callee is a bare identifier with the given name (lifecycle
/// hooks `onMount`/`onCleanup` are recognized by name, like `$effect`).
fn is_callee(call: &CallExpression, name: &str) -> bool {
    matches!(&call.callee, Expression::Identifier(id) if id.name == name)
}

/// Compiler macros (handled by lowering, not real `@opentf/web` exports) — so a
/// legacy `import { $state } from "@opentf/web"` is dropped rather than re-emitted.
fn is_macro_name(name: &str) -> bool {
    matches!(name, "$state" | "$derived" | "$ref" | "$effect" | "$expose" | "$signal")
}

/// Map JSX attribute names to their DOM equivalents (`className` → `class`,
/// `htmlFor` → `for`). Everything else passes through unchanged.
fn dom_attr_name(name: &str) -> String {
    match name {
        "className" => "class".to_string(),
        "htmlFor" => "for".to_string(),
        other => other.to_string(),
    }
}

/// Slice `source[span]` as an owned string (for verbatim pattern capture).
fn slice_span(source: &str, span: Span) -> String {
    source[span.start as usize..span.end as usize].to_string()
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

/// True when `id` resolves to `symbol` through the semantic model.
fn resolves_to(scoping: &Scoping, id: &IdentifierReference, symbol: SymbolId) -> bool {
    id.reference_id
        .get()
        .and_then(|r| scoping.get_reference(r).symbol_id())
        == Some(symbol)
}

/// Collects, over the whole component, the keys accessed as `props.key` for the
/// props-object form (SPEC §2.8). Each becomes an observed signal; `children` is
/// the slot, tracked separately and excluded from the observed set.
struct PropsKeyCollector<'r> {
    scoping: &'r Scoping,
    props_symbol: SymbolId,
    keys: Vec<String>,
    has_children: bool,
}

impl<'a> Visit<'a> for PropsKeyCollector<'_> {
    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Expression::Identifier(obj) = &it.object
            && resolves_to(self.scoping, obj, self.props_symbol)
        {
            let key = it.property.name.as_str();
            if key == "children" {
                self.has_children = true;
            } else if !self.keys.iter().any(|k| k == key) {
                self.keys.push(key.to_string());
            }
            return; // `props` itself is not a signal; nothing deeper to collect.
        }
        walk::walk_static_member_expression(self, it);
    }
}

/// Collects the end offsets of identifier references that resolve to signals,
/// so `.value` can be spliced in after each. For the props-object form it also
/// applies the **First-Access Rule** (SPEC §2.9): `.value` is spliced after the
/// property immediately following `props` (`props.user.name` → `props.user.value.name`).
struct RefCollector<'r> {
    scoping: &'r Scoping,
    signals: &'r HashMap<SymbolId, SignalId>,
    props_symbol: Option<SymbolId>,
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

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Some(ps) = self.props_symbol
            && let Expression::Identifier(obj) = &it.object
            && resolves_to(self.scoping, obj, ps)
        {
            // First-Access Rule: unwrap the first property after `props`, except
            // `props.children` (the slot), which stays as-is (SPEC §3.3).
            if it.property.name != "children" {
                self.ends.push(it.property.span.end);
            }
            return;
        }
        walk::walk_static_member_expression(self, it);
    }
}

fn new_collector<'r>(
    scoping: &'r Scoping,
    signals: &'r HashMap<SymbolId, SignalId>,
    props_symbol: Option<SymbolId>,
) -> RefCollector<'r> {
    RefCollector { scoping, signals, props_symbol, ends: Vec::new(), deps: Vec::new() }
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
    props_symbol: Option<SymbolId>,
    expr: &JSXExpression,
) -> ExprInfo {
    let mut rc = new_collector(scoping, signals, props_symbol);
    rc.visit_jsx_expression(expr);
    ExprInfo { code: splice(source, expr.span(), rc.ends), deps: rc.deps }
}

fn inject_arg(
    source: &str,
    scoping: &Scoping,
    signals: &HashMap<SymbolId, SignalId>,
    props_symbol: Option<SymbolId>,
    arg: &Argument,
) -> ExprInfo {
    let mut rc = new_collector(scoping, signals, props_symbol);
    rc.visit_argument(arg);
    ExprInfo { code: splice(source, arg.span(), rc.ends), deps: rc.deps }
}

fn inject_expr(
    source: &str,
    scoping: &Scoping,
    signals: &HashMap<SymbolId, SignalId>,
    props_symbol: Option<SymbolId>,
    expr: &Expression,
) -> ExprInfo {
    let mut rc = new_collector(scoping, signals, props_symbol);
    rc.visit_expression(expr);
    ExprInfo { code: splice(source, expr.span(), rc.ends), deps: rc.deps }
}

/// Preserve a whole body statement verbatim with `.value` injected on signal
/// references (e.g. local handlers `const f = () => count++` or helper data).
fn inject_stmt(
    source: &str,
    scoping: &Scoping,
    signals: &HashMap<SymbolId, SignalId>,
    props_symbol: Option<SymbolId>,
    stmt: &Statement,
) -> String {
    let mut rc = new_collector(scoping, signals, props_symbol);
    rc.visit_statement(stmt);
    splice(source, stmt.span(), rc.ends)
}

// ── Dynamic node regions (conditional / element-valued holes) ────────────────

/// Probes whether an expression embeds any JSX → it's a dynamic *node* region
/// (`{cond && <p/>}`) rather than a plain text hole.
struct JsxProbe {
    found: bool,
}

impl<'a> Visit<'a> for JsxProbe {
    fn visit_jsx_element(&mut self, _: &JSXElement<'a>) {
        self.found = true;
    }
    fn visit_jsx_fragment(&mut self, _: &JSXFragment<'a>) {
        self.found = true;
    }
}

fn has_jsx_jsx(expr: &JSXExpression) -> bool {
    let mut p = JsxProbe { found: false };
    p.visit_jsx_expression(expr);
    p.found
}

fn has_jsx_expr(expr: &Expression) -> bool {
    let mut p = JsxProbe { found: false };
    p.visit_expression(expr);
    p.found
}

/// One embedded JSX branch of a dynamic node region.
enum JsxBranch<'a> {
    Element(&'a JSXElement<'a>),
    Fragment(&'a JSXFragment<'a>),
}

impl JsxBranch<'_> {
    fn span(&self) -> Span {
        match self {
            JsxBranch::Element(e) => e.span,
            JsxBranch::Fragment(f) => f.span,
        }
    }
}

/// Collects, for a dynamic node region, the signal-reference ends for `.value`
/// injection (First-Access on `props`) and the *outermost* embedded JSX nodes —
/// it does not recurse into them, so each becomes its own node-builder and inner
/// references are injected when that branch is lowered as an ordinary view.
struct NodeTemplater<'a, 'r> {
    scoping: &'r Scoping,
    signals: &'r HashMap<SymbolId, SignalId>,
    props_symbol: Option<SymbolId>,
    ends: Vec<u32>,
    branches: Vec<JsxBranch<'a>>,
}

impl<'a> Visit<'a> for NodeTemplater<'a, '_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if let Some(ref_id) = it.reference_id.get()
            && let Some(symbol) = self.scoping.get_reference(ref_id).symbol_id()
            && self.signals.contains_key(&symbol)
        {
            self.ends.push(it.span.end);
        }
    }
    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Some(ps) = self.props_symbol
            && let Expression::Identifier(obj) = &it.object
            && resolves_to(self.scoping, obj, ps)
        {
            if it.property.name != "children" {
                self.ends.push(it.property.span.end);
            }
            return;
        }
        walk::walk_static_member_expression(self, it);
    }
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        self.branches.push(JsxBranch::Element(self.alloc(it)));
    }
    fn visit_jsx_fragment(&mut self, it: &JSXFragment<'a>) {
        self.branches.push(JsxBranch::Fragment(self.alloc(it)));
    }
}

/// The placeholder a branch's node-builder call replaces in the template
/// (NUL-delimited so it can never collide with real source).
fn branch_placeholder(i: usize) -> String {
    format!("\u{0}{i}\u{0}")
}

/// Build the dynamic-node template: the expression source with `.value` spliced
/// at `ends` and each embedded JSX span replaced by its slot placeholder.
fn build_template(source: &str, span: Span, ends: Vec<u32>, branches: &[JsxBranch]) -> String {
    let base = span.start as usize;
    let slice = &source[base..span.end as usize];
    // Edits as (start, end, replacement); `.value` inserts are zero-width.
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    for e in ends {
        let r = e as usize - base;
        edits.push((r, r, ".value".to_string()));
    }
    for (i, b) in branches.iter().enumerate() {
        let s = b.span();
        edits.push((s.start as usize - base, s.end as usize - base, branch_placeholder(i)));
    }
    edits.sort_by_key(|e| e.0);

    let mut out = String::with_capacity(slice.len());
    let mut last = 0usize;
    for (s, e, text) in edits {
        out.push_str(&slice[last..s]);
        out.push_str(&text);
        last = e;
    }
    out.push_str(&slice[last..]);
    out
}

// ── View lowering ───────────────────────────────────────────────────────────

struct Lowerer<'a, 'r> {
    source: &'a str,
    scoping: &'r Scoping,
    /// Owned so list-item parameters can be scoped in/out during lowering.
    signals: HashMap<SymbolId, SignalId>,
    /// The `children` slot binding's symbol, if the component destructures it.
    children_symbol: Option<SymbolId>,
    /// The props-object binding's symbol (props-object form), driving First-Access
    /// injection and `{props.children}` slot detection.
    props_symbol: Option<SymbolId>,
    /// The page/layout plain props parameter name, so `{props.children}` lowers to
    /// the children slot in page mode (where there is no `props_symbol`).
    page_param: Option<String>,
    exprs: ExprTable,
    errors: Vec<String>,
}

/// Sentinel id for a list-item parameter signal: it participates in `.value`
/// injection but is not a component-level signal (deps are codegen-irrelevant).
const ITEM_PARAM_SIGNAL: SignalId = SignalId(u32::MAX);

impl<'a, 'r> Lowerer<'a, 'r> {
    fn new(
        source: &'a str,
        scoping: &'r Scoping,
        signals: HashMap<SymbolId, SignalId>,
        children_symbol: Option<SymbolId>,
        props_symbol: Option<SymbolId>,
        page_param: Option<String>,
    ) -> Self {
        Self {
            source,
            scoping,
            signals,
            children_symbol,
            props_symbol,
            page_param,
            exprs: ExprTable::default(),
            errors: Vec::new(),
        }
    }

    /// True when `expr` is the `children` slot: a bare reference to the
    /// destructured `children` binding, or `props.children` (SPEC §4.5/§3.3).
    fn is_children_ref(&self, expr: &JSXExpression) -> bool {
        if let Some(target) = self.children_symbol
            && let JSXExpression::Identifier(id) = expr
            && resolves_to(self.scoping, id, target)
        {
            return true;
        }
        if let Some(ps) = self.props_symbol
            && let JSXExpression::StaticMemberExpression(m) = expr
            && m.property.name == "children"
            && let Expression::Identifier(obj) = &m.object
            && resolves_to(self.scoping, obj, ps)
        {
            return true;
        }
        // Page/layout mode: `<param>.children` (no signal symbol) is the slot.
        if let Some(param) = &self.page_param
            && let JSXExpression::StaticMemberExpression(m) = expr
            && m.property.name == "children"
            && let Expression::Identifier(obj) = &m.object
            && obj.name == param.as_str()
        {
            return true;
        }
        false
    }

    fn slice(&self, span: Span) -> &'a str {
        &self.source[span.start as usize..span.end as usize]
    }

    fn intern_jsx(&mut self, expr: &JSXExpression) -> ExpressionId {
        let info = inject_jsx(self.source, self.scoping, &self.signals, self.props_symbol, expr);
        self.exprs.intern(info)
    }

    /// Lower a JSX-bearing hole (`{cond && <p/>}`) into a `DynamicNode`: a
    /// templated expression plus a node-builder branch per embedded JSX.
    fn lower_dynamic_node(&mut self, expr: &JSXExpression<'a>, span: Span) -> ViewNode {
        let (ends, branches) = {
            let mut t = NodeTemplater {
                scoping: self.scoping,
                signals: &self.signals,
                props_symbol: self.props_symbol,
                ends: Vec::new(),
                branches: Vec::new(),
            };
            t.visit_jsx_expression(expr);
            (t.ends, t.branches)
        };
        self.finish_dynamic_node(span, ends, branches)
    }

    /// As [`lower_dynamic_node`] but for a bare expression (a conditional root
    /// return, `return cond ? <a/> : <b/>`).
    fn lower_dynamic_node_expr(&mut self, expr: &Expression<'a>, span: Span) -> ViewNode {
        let (ends, branches) = {
            let mut t = NodeTemplater {
                scoping: self.scoping,
                signals: &self.signals,
                props_symbol: self.props_symbol,
                ends: Vec::new(),
                branches: Vec::new(),
            };
            t.visit_expression(expr);
            (t.ends, t.branches)
        };
        self.finish_dynamic_node(span, ends, branches)
    }

    fn finish_dynamic_node(
        &mut self,
        span: Span,
        ends: Vec<u32>,
        branches: Vec<JsxBranch<'a>>,
    ) -> ViewNode {
        let template = build_template(self.source, span, ends, &branches);
        let branch_nodes = branches
            .into_iter()
            .map(|b| match b {
                JsxBranch::Element(e) => self.lower_element(e),
                JsxBranch::Fragment(f) => ViewNode::Fragment(self.lower_children(&f.children)),
            })
            .collect();
        let expr = self.exprs.intern(ExprInfo { code: template, deps: Vec::new() });
        ViewNode::DynamicNode { expr, branches: branch_nodes }
    }

    fn lower_root(&mut self, expr: &'a Expression<'a>) -> Option<ViewNode> {
        match unwrap_paren(expr) {
            Expression::JSXElement(el) => Some(self.lower_element(el)),
            Expression::JSXFragment(fr) => {
                Some(ViewNode::Fragment(self.lower_children(&fr.children)))
            }
            // A conditional/element-valued root (`return cond ? <a/> : <b/>`):
            // wrap the dynamic region in a fragment so it has a container.
            other if has_jsx_expr(other) => {
                let node = self.lower_dynamic_node_expr(other, other.span());
                Some(ViewNode::Fragment(vec![node]))
            }
            _ => {
                self.errors.push("component root is not a JSX element or fragment".into());
                None
            }
        }
    }

    fn lower_element(&mut self, el: &'a JSXElement<'a>) -> ViewNode {
        let name = self.element_name(&el.opening_element.name);
        let props = self.lower_attrs(el);
        let children = self.lower_children(&el.children);
        if is_component_name(&name) {
            ViewNode::Component { name, props, children }
        } else {
            ViewNode::Element { tag: name, props, children }
        }
    }

    fn lower_children(&mut self, children: &'a [JSXChild<'a>]) -> Vec<ViewNode> {
        children.iter().filter_map(|child| self.lower_child(child)).collect()
    }

    fn lower_child(&mut self, child: &'a JSXChild<'a>) -> Option<ViewNode> {
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
                _ => {
                    if let Some(list) = self.try_lower_list(&c.expression) {
                        Some(list)
                    } else if has_jsx_jsx(&c.expression) {
                        // A hole that can yield DOM nodes (`{cond && <p/>}`).
                        Some(self.lower_dynamic_node(&c.expression, c.expression.span()))
                    } else {
                        Some(ViewNode::Dynamic { expr: self.intern_jsx(&c.expression) })
                    }
                }
            },
            JSXChild::Spread(s) => {
                // `{...items}`: render each item of the (array) expression as a
                // child; `bindChild` flattens arrays, so reuse the dynamic region.
                Some(self.lower_dynamic_node_expr(&s.expression, s.expression.span()))
            }
        }
    }

    fn lower_attrs(&mut self, el: &JSXElement) -> Vec<Prop> {
        let mut props = Vec::new();
        for item in &el.opening_element.attributes {
            match item {
                JSXAttributeItem::Attribute(attr) => {
                    let name = match &attr.name {
                        JSXAttributeName::Identifier(id) => dom_attr_name(id.name.as_str()),
                        JSXAttributeName::NamespacedName(n) => {
                            format!("{}:{}", n.namespace.name, n.name.name)
                        }
                    };
                    // `ref={expr}`: keep the expression raw (no `.value` injection,
                    // SPEC §3.3) — codegen assigns the node to the ref signal
                    // (`expr.value = el`, SPEC §5.6).
                    if name == "ref" {
                        if let Some(JSXAttributeValue::ExpressionContainer(c)) = &attr.value
                            && !matches!(c.expression, JSXExpression::EmptyExpression(_))
                        {
                            let id = self.intern_static(c.expression.span());
                            props.push(Prop { name, value: PropValue::Dynamic(id) });
                        }
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
                    // `{...obj}`: an empty prop name marks a spread; it is applied
                    // in source order so later props can override (SPEC §5.5).
                    let info = inject_expr(
                        self.source,
                        self.scoping,
                        &self.signals,
                        self.props_symbol,
                        &s.argument,
                    );
                    let id = self.exprs.intern(info);
                    props.push(Prop { name: String::new(), value: PropValue::Dynamic(id) });
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
    fn try_lower_list(&mut self, expr: &'a JSXExpression<'a>) -> Option<ViewNode> {
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
        let source_info =
            inject_expr(self.source, self.scoping, &self.signals, self.props_symbol, &member.object);
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
        lower_component("/app/App.tsx", &parsed.program, source, false).expect("a component")
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
    fn discovers_props_object_keys_and_injects_first_access() {
        let lowered = lower(
            "export function Card(props) { return <div>{props.title}{props.user.name}</div>; }",
        );
        // Keys discovered from `props.key` access become observed props (in
        // first-seen order); deep access reports only the first-level key.
        assert_eq!(lowered.props_object.as_deref(), Some("props"));
        assert_eq!(
            lowered.props.iter().map(|p| p.attr.as_str()).collect::<Vec<_>>(),
            ["title", "user"]
        );
        // First-Access Rule: `.value` after the first property only.
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::Dynamic { expr } = &children[0] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("props.title.value"));
        let ViewNode::Dynamic { expr } = &children[1] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("props.user.value.name"));
    }

    #[test]
    fn props_object_children_is_the_slot() {
        let lowered =
            lower("export function Wrap(props) { return <div>{props.children}</div>; }");
        // `props.children` is the slot, not an observed key.
        assert!(lowered.props.is_empty());
        assert_eq!(lowered.children_local.as_deref(), Some("__children"));
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        assert_eq!(children[0], ViewNode::Children);
    }

    #[test]
    fn lowers_rest_prop_as_snapshot() {
        let lowered = lower("export function C({ a, ...rest }) { return <p>{a}</p>; }");
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        // `a` stays a reactive named prop; `rest` snapshots the other attributes.
        assert_eq!(lowered.props.iter().map(|p| p.attr.as_str()).collect::<Vec<_>>(), ["a"]);
        let rest = lowered.rest.expect("rest prop");
        assert_eq!(rest.name, "rest");
        assert_eq!(rest.exclude, ["a"]);
    }

    #[test]
    fn lowers_nested_prop_as_snapshot() {
        let lowered = lower(
            "export function C({ user: { name } }) { return <p>{name}</p>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        // The outer key is observed; the inner binding is a one-time snapshot
        // (non-reactive, so no `.value` injection on `name`).
        assert_eq!(lowered.props.iter().map(|p| p.attr.as_str()).collect::<Vec<_>>(), ["user"]);
        let snap = &lowered.prop_snapshots[0];
        assert_eq!(snap.pattern, "{ name }");
        assert_eq!(snap.source, "user");
        assert_eq!(snap.empty, "{}");
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::Dynamic { expr } = &children[0] else { panic!() };
        assert_eq!(lowered.exprs.code(*expr), Some("name"));
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
    fn lowers_conditional_element_hole_as_dynamic_node() {
        let lowered = lower(
            "export function C() { let on = $state(true); return <div>{on ? <a/> : <b/>}</div>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        let ViewNode::DynamicNode { expr, branches } = &children[0] else {
            panic!("expected dynamic node, got {:?}", children[0]);
        };
        // Template: `.value` injected on the signal, JSX replaced by slot markers.
        assert_eq!(lowered.exprs.code(*expr), Some("on.value ? \u{0}0\u{0} : \u{0}1\u{0}"));
        // Two branches lowered as ordinary elements.
        assert_eq!(branches.len(), 2);
        assert!(matches!(&branches[0], ViewNode::Element { tag, .. } if tag == "a"));
        assert!(matches!(&branches[1], ViewNode::Element { tag, .. } if tag == "b"));
    }

    #[test]
    fn lowers_logical_hole_and_root_conditional() {
        // `&&` hole keeps text-valued holes as plain Dynamic but element ones as nodes.
        let l1 = lower("export function C() { let on = $state(true); return <div>{on && <p>x</p>}</div>; }");
        let ViewNode::Element { children, .. } = &l1.ir.view else { panic!() };
        assert!(matches!(&children[0], ViewNode::DynamicNode { .. }));

        // A conditional *root* return is detected as a component and wrapped.
        let l2 = lower("export function C() { let ok = $state(true); return ok ? <a/> : <b/>; }");
        assert!(l2.errors.is_empty(), "errors: {:?}", l2.errors);
        let ViewNode::Fragment(children) = &l2.ir.view else {
            panic!("expected fragment root, got {:?}", l2.ir.view);
        };
        assert!(matches!(&children[0], ViewNode::DynamicNode { .. }));
    }

    #[test]
    fn plain_expression_hole_stays_text() {
        // No embedded JSX → still a text hole, not a dynamic node.
        let lowered = lower("export function C() { let n = $state(0); return <p>{n ? 1 : 2}</p>; }");
        let ViewNode::Element { children, .. } = &lowered.ir.view else { panic!() };
        assert!(matches!(&children[0], ViewNode::Dynamic { .. }));
    }

    #[test]
    fn lowers_spread_prop_and_child() {
        let lowered = lower(
            "export function C() { let o = $state({}); let xs = $state([]); return <div {...o} id=\"k\">{...xs}</div>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        let ViewNode::Element { props, children, .. } = &lowered.ir.view else { panic!() };
        // Spread prop: empty-name sentinel, injected expr, before the static `id`.
        assert_eq!(props[0].name, "");
        let PropValue::Dynamic(expr) = props[0].value else { panic!() };
        assert_eq!(lowered.exprs.code(expr), Some("o.value"));
        assert_eq!(props[1], Prop { name: "id".into(), value: PropValue::Static("k".into()) });
        // Spread child: a dynamic node region over the (array) expression.
        assert!(matches!(&children[0], ViewNode::DynamicNode { .. }));
    }

    #[test]
    fn lowers_expose() {
        let lowered = lower(
            "export function C() { let n = $state(0); $expose({ inc: () => n++ }); return <p>{n}</p>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        assert_eq!(lowered.exposes, ["{ inc: () => n.value++ }"]);
    }

    #[test]
    fn lowers_ref_attribute_raw() {
        let lowered = lower(
            "export function C() { let box = $ref(); return <div ref={box}>hi</div>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        let ViewNode::Element { props, .. } = &lowered.ir.view else { panic!() };
        let ref_prop = props.iter().find(|p| p.name == "ref").expect("ref prop");
        let PropValue::Dynamic(expr) = ref_prop.value else { panic!() };
        // Ref keeps the expression raw — no `.value` injection (SPEC §3.3).
        assert_eq!(lowered.exprs.code(expr), Some("box"));
    }

    #[test]
    fn lowers_effect_with_injection() {
        let lowered = lower(
            "export function C() { let n = $state(0); $effect(() => console.log(n)); return <p>{n}</p>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        // The effect callback gets `.value` injected on signal references.
        assert_eq!(lowered.effects, ["() => console.log(n.value)"]);
    }

    #[test]
    fn lowers_lifecycle_hooks_with_injection() {
        let lowered = lower(
            "export function C() { let n = $state(0); onMount(() => console.log(n)); onCleanup(() => n++); return <p>{n}</p>; }",
        );
        assert!(lowered.errors.is_empty(), "errors: {:?}", lowered.errors);
        assert_eq!(lowered.on_mounts, ["() => console.log(n.value)"]);
        assert_eq!(lowered.on_cleanups, ["() => n.value++"]);
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
