//! SSG codegen backend (ARCHITECTURE.md §6) — a pure consumer of the View IR,
//! sibling to `csr.rs`. Where CSR emits DOM operations + reactive effects, SSG
//! emits JS that **concatenates an HTML string** at build time. No DOM, no
//! `effect()`, no `connectedCallback`, no `onMount`/`$effect` — those are
//! client-runtime concerns and are simply never emitted here (so SSG can't run
//! client-only side effects). Dynamic values are still evaluated (the emitted JS
//! runs in Bun at build time), but only to read `.value` once into the string.
//!
//! Each page/layout compiles to `export default function(props){ return html; }`
//! and each component to `function Name_ssg(props, children){ return html; }` plus
//! `defineSSG("web-name", …)`, so a parent renders `<web-name>${inner}</web-name>`
//! via the registry — mirroring how CSR composes by tag.
//!
//! Member-expression component names are unsupported by design (SPEC §4.0.1).

use std::collections::BTreeSet;

use otfw_ir::reactivity::SignalKind;
use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::ExpressionId;

use crate::codegen::{static_tree, tags};
use crate::lower::{BodyItem, ExprTable, Lowered, SignalDecl};

/// HTML void elements (no closing tag).
const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// The generated SSG module: imports + page factories / component renderers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SsgModule {
    pub code: String,
    pub errors: Vec<String>,
}

impl SsgModule {
    pub fn is_complete(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Emit a whole module (pages + co-located components + preserved top-level
/// statements) as SSG render functions under a shared import header.
pub fn emit_module(
    components: &[Lowered],
    module_stmts: &[BodyItem],
    module_exprs: &ExprTable,
) -> SsgModule {
    let mut server: BTreeSet<&str> = BTreeSet::new();
    let mut core: BTreeSet<&str> = BTreeSet::new();
    let mut errors = Vec::new();
    let mut bodies = Vec::new();

    for c in components {
        // Lowering diagnostics surface alongside codegen errors (CLI warnings).
        errors.extend(c.errors.iter().cloned());
        let mut e = Emitter::new(c);
        let body = if c.is_page { e.page(c) } else { e.component(c) };
        server.extend(e.server);
        core.extend(e.core);
        errors.extend(e.errors);
        bodies.push(body);
    }

    // Preserved module-level statements (shared data/consts; JSX-as-value).
    let mut module_code = String::new();
    {
        let mut e = Emitter::new_module(module_exprs);
        for item in module_stmts {
            e.emit_stmt(item, &mut module_code);
        }
        server.extend(e.server);
        core.extend(e.core);
        errors.extend(e.errors);
    }

    let mut code = String::new();
    if let Some(first) = components.first() {
        if !first.imports.is_empty() {
            code.push_str(&first.imports.join("\n"));
            code.push('\n');
        }
        code.push_str(&import_header(&core, &server, &first.runtime_imports));
    } else {
        code.push_str(&import_header(&core, &server, &[]));
    }
    code.push_str(&module_code);
    for body in bodies {
        code.push_str(&body);
    }
    SsgModule { code, errors }
}

fn import_header(core: &BTreeSet<&str>, server: &BTreeSet<&str>, runtime: &[String]) -> String {
    let mut out = String::new();
    // `@opentf/web`: the signal helpers SSG itself needs (for `.value` reads) plus
    // the source's own named imports (createContext, router, emit, Link, …) so
    // module/handler code referencing them resolves. JSX tags like <Link> compile
    // to the SSG registry, but the bindings stay valid exports — keep them.
    let mut core_names: Vec<String> = core.iter().map(|s| s.to_string()).collect();
    for r in runtime {
        if !core_names.contains(r) {
            core_names.push(r.clone());
        }
    }
    if !core_names.is_empty() {
        out.push_str(&format!("import {{ {} }} from \"@opentf/web\";\n", core_names.join(", ")));
    }
    if !server.is_empty() {
        let names: Vec<&str> = server.iter().copied().collect();
        out.push_str(&format!("import {{ {} }} from \"@opentf/web/server\";\n", names.join(", ")));
    }
    out
}

struct Emitter<'a> {
    exprs: &'a ExprTable,
    errors: Vec<String>,
    server: BTreeSet<&'static str>,
    core: BTreeSet<&'static str>,
    is_page: bool,
    page_param: Option<String>,
    /// Sibling component names, so a same-module `<Sibling/>` resolves via its
    /// in-scope render fn (`{name}_ssg`) rather than a recomputed tag.
    module_components: Vec<String>,
    /// This component's own Custom Element tag — the label stamped on its `{children}`
    /// slot markers (`<!--c[web-card-8e61e2ff-->`), so the parent can find *this* host's
    /// slot among the markers of the components nested around it. `None` for a page.
    self_tag: Option<String>,
    counter: u32,
}

impl<'a> Emitter<'a> {
    fn new(lowered: &'a Lowered) -> Self {
        Self {
            exprs: &lowered.exprs,
            errors: Vec::new(),
            server: BTreeSet::new(),
            core: BTreeSet::new(),
            is_page: lowered.is_page,
            page_param: lowered.page_param.clone(),
            module_components: lowered.module_components.clone(),
            self_tag: if lowered.is_page {
                None
            } else {
                Some(tags::def_tag(&lowered.name, &lowered.ir.id.module))
            },
            counter: 0,
        }
    }

    fn new_module(exprs: &'a ExprTable) -> Self {
        Self {
            exprs,
            errors: Vec::new(),
            server: BTreeSet::new(),
            core: BTreeSet::new(),
            is_page: false,
            page_param: None,
            module_components: Vec::new(),
            self_tag: None,
            counter: 0,
        }
    }

    fn fresh(&mut self) -> u32 {
        let n = self.counter;
        self.counter += 1;
        n
    }

    fn code(&self, id: ExpressionId) -> String {
        self.exprs.code(id).unwrap_or("undefined").to_string()
    }

    // ── page / component shells ──────────────────────────────────────────────

    fn page(&mut self, lowered: &Lowered) -> String {
        let param = self.page_param.clone().unwrap_or_default();
        let mut decls = String::new();
        for item in &lowered.body {
            self.emit_stmt(item, &mut decls);
        }
        let view = self.html_expr(&lowered.ir.view);
        let export = &lowered.ir.id.export;
        let header = if export == "default" {
            format!("export default function ({param}) {{\n")
        } else {
            format!("export function {export}({param}) {{\n")
        };
        format!("{header}{decls}  return {view};\n}}\n")
    }

    fn component(&mut self, lowered: &Lowered) -> String {
        let name = &lowered.name;
        let tag = tags::def_tag(name, &lowered.ir.id.module);
        let mut decls = String::new();
        self.emit_prop_setup(lowered, &mut decls);
        for item in &lowered.body {
            self.emit_stmt(item, &mut decls);
        }
        let view = self.html_expr(&lowered.ir.view);

        let mut out = String::new();
        out.push_str(&format!("function {name}_ssg(__props, __children) {{\n"));
        out.push_str("  try {\n");
        out.push_str(&indent(&decls, "  "));
        out.push_str(&format!("    return {view};\n"));
        out.push_str("  } catch (e) { return \"\"; }\n"); // fail soft (client handles it)
        out.push_str("}\n");
        self.server.insert("defineSSG");
        // Module-namespaced tag attached to the render fn so a parent that imports
        // this component addresses it via the binding's `.tag` (collision-free); the
        // stable `hostClass` is stamped on the rendered host so CSS can style it by a
        // readable name (mirrors the CSR `classList.add`).
        out.push_str(&format!("{name}_ssg.tag = {};\n", js_string(&tag)));
        out.push_str(&format!("{name}_ssg.hostClass = {};\n", js_string(&tags::css_hook(name))));
        out.push_str(&format!("defineSSG({name}_ssg.tag, {name}_ssg);\n"));
        if lowered.is_default_export {
            out.push_str(&format!("export default {name}_ssg;\n"));
        }
        out
    }

    /// Bind a component's props as `{ value }` wrappers so the lowered body's
    /// `name.value` reads resolve (CSR backs them with signals; SSG passes plain
    /// props in and wraps them).
    fn emit_prop_setup(&mut self, lowered: &Lowered, out: &mut String) {
        if let Some(local) = &lowered.props_object {
            if !lowered.props.is_empty() {
                let mut entries = Vec::new();
                for p in &lowered.props {
                    entries.push(format!(
                        "{}: {{ value: __props?.[{}] {} }}",
                        p.attr,
                        js_string(&p.attr),
                        p.default.as_ref().map(|d| format!("?? ({d})")).unwrap_or_default()
                    ));
                }
                out.push_str(&format!("const {local} = {{ {} }};\n", entries.join(", ")));
            } else {
                out.push_str(&format!("const {local} = {{}};\n"));
            }
        } else {
            for p in &lowered.props {
                out.push_str(&format!(
                    "const {} = {{ value: __props?.[{}] {} }};\n",
                    p.local,
                    js_string(&p.attr),
                    p.default.as_ref().map(|d| format!("?? ({d})")).unwrap_or_default()
                ));
            }
        }
        if lowered.rest.is_some() || !lowered.prop_snapshots.is_empty() {
            self.errors
                .push("SSG: rest props / destructure snapshots not supported yet".into());
        }
    }

    // ── statements (decls / preserved code / JSX-as-value) ───────────────────

    fn emit_stmt(&mut self, item: &BodyItem, out: &mut String) {
        match item {
            BodyItem::Signal(decl) => self.emit_decl(decl, out),
            BodyItem::Raw(stmt) => out.push_str(&format!("{stmt}\n")),
            BodyItem::Jsx { template, nodes } => {
                let calls: Vec<String> =
                    nodes.iter().map(|n| format!("{{ __html: {} }}", self.html_expr(n))).collect();
                out.push_str(&format!("{}\n", substitute_branches(template, &calls)));
            }
        }
    }

    fn emit_decl(&mut self, decl: &SignalDecl, out: &mut String) {
        match decl.kind {
            SignalKind::State => {
                self.core.insert("signal");
                out.push_str(&format!("const {} = signal({});\n", decl.name, decl.init));
            }
            SignalKind::Ref => {
                self.core.insert("signal");
                out.push_str(&format!("const {} = signal(null);\n", decl.name));
            }
            SignalKind::Derived => {
                self.core.insert("computed");
                let body = if decl.init_is_fn {
                    decl.init.clone()
                } else {
                    format!("() => {}", decl.init)
                };
                out.push_str(&format!("const {} = computed({});\n", decl.name, body));
            }
            SignalKind::Context => {
                // SSG has no DOM provider chain; resolve to the context default.
                out.push_str(&format!("const {} = ({}).fallback;\n", decl.name, decl.init));
            }
            SignalKind::Prop => {
                self.errors.push(format!("prop signal not supported yet: {}", decl.name));
            }
        }
    }

    // ── the view: each node → a JS expression evaluating to an HTML string ────

    /// One node → a single JS expression evaluating to an HTML string.
    fn html_expr(&mut self, node: &ViewNode) -> String {
        let terms = self.html_terms(node);
        join_plus(&terms)
    }

    /// One node → the *flat* sequence of `+` terms it contributes.
    ///
    /// Nesting is deliberately not reflected here: an element splices its children's
    /// terms into its own list rather than embedding a pre-joined sub-expression. That
    /// keeps every static fragment in a subtree adjacent in one list, so the single
    /// `join_plus` at the top can fold the whole run into one literal. Joining per level
    /// instead would leave each child a compound expression, blocking the merge at every
    /// boundary and rebuilding the deep `+` chain this exists to avoid.
    fn html_terms(&mut self, node: &ViewNode) -> Vec<String> {
        match node {
            ViewNode::Text(text) => vec![js_string(&escape_text(text))],
            ViewNode::Element { tag, props, children } => self.element(tag, props, children),
            ViewNode::Dynamic { expr } => {
                self.server.insert("ssgText");
                // Hydration text-hole markers (docs/HYDRATION.md §3.1): bracket the value
                // with `<!--$-->…<!--/-->` so the client can claim the text node even when
                // it is empty or adjacent to static text (the HTML parser would otherwise
                // merge them). Inert for plain SSG output (just an HTML comment).
                vec![
                    "\"<!--$-->\"".to_string(),
                    format!("ssgText({})", self.code(*expr)),
                    "\"<!--/-->\"".to_string(),
                ]
            }
            ViewNode::Component { name, props, children } => {
                vec![self.component_use(name, props, children)]
            }
            ViewNode::DynamicNode { expr, branches } => {
                let calls: Vec<String> = branches
                    .iter()
                    .map(|b| format!("{{ __html: {} }}", self.html_expr(b)))
                    .collect();
                let template = self.code(*expr);
                self.server.insert("ssgText");
                // Bracket the rendered branch with region markers (docs/HYDRATION.md §3.1) so
                // the client can find the region to adopt/swap it — the closing `<!--]-->`
                // becomes the swap anchor. An empty branch (falsy `&&`) renders nothing between
                // the markers, mirroring an empty list. Inert for static SSG output.
                vec![
                    "\"<!--[-->\"".to_string(),
                    format!("ssgText({})", substitute_branches(&template, &calls)),
                    "\"<!--]-->\"".to_string(),
                ]
            }
            ViewNode::Children => {
                if self.is_page {
                    // Bracket a page/layout's slot with region markers (docs/HYDRATION.md
                    // §3.1, 2.1c) so the hydrating layout can find the nested route's DOM,
                    // hand its cursor to the children adopt-thunk, and resume after it. Inert
                    // for static SSG output.
                    let inner = match &self.page_param {
                        Some(p) => format!("({p}?.children ?? \"\")"),
                        None => "\"\"".to_string(),
                    };
                    vec!["\"<!--[-->\"".to_string(), inner, "\"<!--]-->\"".to_string()]
                } else {
                    // A component's light-DOM `{children}` slot (2.1d): bracket it with the
                    // distinct `<!--c[…-->…<!--c]…-->` slot markers so the component can step
                    // over it and the parent can locate + adopt the slotted content (whose
                    // reactivity the parent owns). Inert for static SSG output.
                    //
                    // The markers carry **this component's own tag**. Slot regions nest —
                    // a component that forwards `{children}` into another component
                    // (`Card` → `<Link>{children}</Link>`) puts its markers inside that
                    // component's, and a parent that itself forwards adds a third pair at the
                    // same spot. Unlabeled, neither side could tell which pair was its own:
                    // the component's walk stopped at the first close it saw (a nested one)
                    // and the parent's `hydrateSlot` guessed by tree order and adopted against
                    // another component's region. The tag makes both lookups exact.
                    let tag = self.self_tag.clone().unwrap_or_default();
                    vec![
                        format!("\"<!--c[{tag}-->\""),
                        "(__children ?? \"\")".to_string(),
                        format!("\"<!--c]{tag}-->\""),
                    ]
                }
            }
            ViewNode::List { source, source_branches, item_param, index_param, item, key: _, preamble } => {
                vec![self.list(*source, source_branches, item_param, index_param.as_deref(), item, preamble)]
            }
            ViewNode::Fragment(children) => self.concat(children),
        }
    }

    fn element(&mut self, tag: &str, props: &[Prop], children: &[ViewNode]) -> Vec<String> {
        // Static attributes fold into the opening literal; dynamic ones append a
        // runtime `attr(name, value)` piece; on*/ref are dropped (no SSR meaning).
        let mut open = format!("<{tag}");
        let mut dyn_attrs: Vec<String> = Vec::new();
        for p in props {
            if p.name.is_empty() {
                self.errors.push("SSG: spread props not supported yet".into());
                continue;
            }
            if p.name == "ref" || is_event(&p.name) {
                continue;
            }
            match &p.value {
                PropValue::Static(v) => open.push_str(&format!(" {}=\"{}\"", p.name, escape_attr(v))),
                // Never produced for DOM elements (valueless attrs stay `Static("")`),
                // but render the presence attribute if it ever reaches here.
                PropValue::Boolean => open.push_str(&format!(" {}=\"\"", p.name)),
                PropValue::Dynamic(id) => {
                    self.server.insert("attr");
                    dyn_attrs.push(format!("attr({}, {})", js_string(&p.name), self.code(*id)));
                }
                PropValue::DynamicNode { expr, branches } => {
                    self.server.insert("attr");
                    let code = self.node_prop_code(*expr, branches);
                    dyn_attrs.push(format!("attr({}, {})", js_string(&p.name), code));
                }
            }
        }

        // `<tag static-attrs` + dynamic attr pieces + `>` + children + `</tag>`.
        let mut pieces: Vec<String> = vec![js_string(&open)];
        pieces.extend(dyn_attrs);
        pieces.push(js_string(">"));
        if VOID.contains(&tag) {
            return pieces;
        }
        // The parser drops one newline directly after `<pre>`/`<listing>`, so when the
        // content itself starts with one, write a second: the parser eats that one and
        // the content keeps its first line. Only literal text can start with a newline in
        // the served bytes — a hole is preceded by its `<!--$-->` marker, which is not a
        // newline, so the parser has nothing to eat and the value survives untouched.
        if static_tree::eats_leading_newline(tag)
            && matches!(children.first(), Some(ViewNode::Text(t)) if t.starts_with('\n'))
        {
            pieces.push(js_string("\n"));
        }
        if static_tree::is_raw_text(tag) {
            pieces.extend(self.raw_text(tag, children));
        } else {
            pieces.extend(self.concat(children));
        }
        pieces.push(js_string(&format!("</{tag}>")));
        pieces
    }

    /// The content of a raw-text element (`<script>`, `<style>`, `<textarea>`, `<title>`).
    ///
    /// Two things are different in here. **No hydration markers**: the tokenizer does not
    /// parse markup inside these elements, so a `<!--$-->` would be served as those literal
    /// characters — visible in the textarea, in the page title, in the stylesheet — and the
    /// adopt walk would then look for a marker comment that is really text. The claim side
    /// takes the element's single text node directly instead (`claimRawText`). **Escaping
    /// follows the tokenizer**: `<textarea>`/`<title>` are *escapable* raw text and still
    /// resolve character references, so their content is escaped like any other text; in
    /// `<script>`/`<style>` an escape would show through literally (`a &gt; b` in a
    /// stylesheet), so the value is written verbatim — matching what the CSR path puts in
    /// the element's text node.
    fn raw_text(&mut self, tag: &str, children: &[ViewNode]) -> Vec<String> {
        let escapable = static_tree::is_escapable_raw_text(tag);
        children
            .iter()
            .map(|child| match child {
                ViewNode::Text(text) => {
                    js_string(&if escapable { escape_text(text) } else { text.clone() })
                }
                ViewNode::Dynamic { expr } => {
                    let code = self.code(*expr);
                    if escapable {
                        self.server.insert("ssgText");
                        format!("ssgText({code})")
                    } else {
                        self.server.insert("ssgRawText");
                        format!("ssgRawText({code})")
                    }
                }
                _ => {
                    self.errors.push(format!(
                        "SSG: <{tag}> can only contain text — its content is not parsed as \
                         markup, so anything else in it would be served as literal characters"
                    ));
                    js_string("")
                }
            })
            .collect()
    }

    fn component_use(&mut self, name: &str, props: &[Prop], children: &[ViewNode]) -> String {
        if name.contains('.') {
            self.errors.push(format!(
                "member-expression component <{name}> is not supported \
                 (components are addressed by a static tag — see SPEC §4.0.1)"
            ));
            return "\"\"".to_string();
        }
        let tag_expr =
            tags::use_tag_expr(name, &self.module_components, &format!("{name}_ssg"));
        let mut entries: Vec<String> = Vec::new();
        for p in props {
            if p.name == "ref" || p.name.is_empty() {
                if p.name.is_empty() {
                    self.errors.push("SSG: spread props not supported yet".into());
                }
                continue;
            }
            let val = match &p.value {
                PropValue::Static(v) => js_string(v),
                // Valueless boolean prop (`<Foo disabled/>`): cross as JS `true`, not
                // the empty string (which would read falsy in the component's props).
                PropValue::Boolean => "true".to_string(),
                PropValue::Dynamic(id) => format!("({})", self.code(*id)),
                PropValue::DynamicNode { expr, branches } => {
                    format!("({})", self.node_prop_code(*expr, branches))
                }
            };
            entries.push(format!("{}: {}", js_object_key(&p.name), val));
        }
        let props_obj = format!("{{ {} }}", entries.join(", "));
        // A component boundary is a real call argument, so its children must be joined
        // into one expression here rather than spliced into the parent's term list.
        let children_terms = self.concat(children);
        let children_html = join_plus(&children_terms);
        self.server.insert("ssgComponent");
        format!("ssgComponent({tag_expr}, {props_obj}, {children_html})")
    }

    /// A prop value embedding JSX (`PropValue::DynamicNode`): render each branch to
    /// its HTML string wrapped as `{ __html }` and substitute the calls into the
    /// templated expression — mirroring how `ViewNode::DynamicNode` is emitted.
    fn node_prop_code(&mut self, expr: ExpressionId, branches: &[ViewNode]) -> String {
        let calls: Vec<String> = branches
            .iter()
            .map(|b| format!("{{ __html: {} }}", self.html_expr(b)))
            .collect();
        let template = self.code(expr);
        substitute_branches(&template, &calls)
    }

    fn list(
        &mut self,
        source: ExpressionId,
        source_branches: &[ViewNode],
        item_param: &str,
        index_param: Option<&str>,
        item: &ViewNode,
        preamble: &[String],
    ) -> String {
        let n = self.fresh();
        let item_html = self.html_expr(item);
        // JSX embedded in the data expression (`[{ icon: <b/> }].map(…)`) renders to an
        // `{ __html }` marker in the data — `ssgText` splices it raw when an item reads it,
        // mirroring how a JSX-valued prop crosses to the server (see `node_prop_code`).
        let source_code = if source_branches.is_empty() {
            self.code(source)
        } else {
            self.node_prop_code(source, source_branches)
        };
        let idx_decl = match index_param {
            Some(idx) => format!("const {idx} = __idx{n}; "),
            None => String::new(),
        };
        // Callback locals (`.value`-injected) run before the item view, after the
        // per-item signal shim, so the SSR item HTML can reference them.
        let preamble_decl = preamble.iter().fold(String::new(), |mut acc, l| {
            acc.push_str(l);
            acc.push(' ');
            acc
        });
        self.server.insert("ssgList");
        // Bracket the list with region markers (docs/HYDRATION.md §3.1) so the client can
        // find the variable region's boundary to reconcile from N. The closing `<!--]-->`
        // becomes the reconcile anchor on hydration; static SSG output treats them as inert
        // comments. Each item renders to one root node (bare-text items keep their own
        // `<!--$-->…<!--/-->` markers), so no per-item separator is needed.
        format!(
            "\"<!--[-->\" + ssgList({}, (__it{n}, __idx{n}) => {{ const {item_param} = {{ value: __it{n} }}; {idx_decl}{preamble_decl}return {item_html}; }}) + \"<!--]-->\"",
            source_code,
            n = n,
            item_param = item_param,
            item_html = item_html,
            idx_decl = idx_decl,
            preamble_decl = preamble_decl,
        )
    }

    /// The flat `+` terms for a run of sibling nodes.
    fn concat(&mut self, children: &[ViewNode]) -> Vec<String> {
        children.iter().flat_map(|c| self.html_terms(c)).collect()
    }
}

/// Join JS expression pieces with `+`, dropping empty-string literals and merging
/// runs of adjacent string literals into one (`"<div" + ">"` → `"<div>"`).
///
/// The merge matters for more than output size. `element`/`concat` feed their result
/// back into a parent `join_plus`, so folding here collapses each fully static subtree
/// into a single literal recursively. Without it a page's markup becomes one expression
/// carrying a `+` per fragment — ~11k of them for a 1000-section docs page — and the
/// deeply left-nested tree that produces is what the downstream bundler chokes on: peak
/// RSS grows ~quadratically with page size, and past roughly 13k terms its parser
/// overflows its stack and crashes the build outright.
fn join_plus(parts: &[String]) -> String {
    let kept: Vec<&String> = parts.iter().filter(|p| p.as_str() != "\"\"").collect();
    if kept.is_empty() {
        return "\"\"".to_string();
    }
    // Carry each piece's literal-ness so a long run folds in linear time rather than
    // re-scanning the accumulated literal on every merge.
    let mut out: Vec<(String, bool)> = Vec::with_capacity(kept.len());
    for part in kept {
        let is_lit = is_string_literal(part);
        match out.last_mut() {
            // Both sides are already-escaped `js_string` literals, so they concatenate
            // textually: drop the left's closing quote and the right's opening one. The
            // result is itself such a literal, so a whole run collapses into one.
            Some((prev, true)) if is_lit => {
                prev.pop();
                prev.push_str(&part[1..]);
            }
            _ => out.push((part.clone(), is_lit)),
        }
    }
    out.into_iter().map(|(s, _)| s).collect::<Vec<_>>().join(" + ")
}

/// True when `code` is exactly one string literal as emitted by `js_string`: double
/// quoted, with every interior `"` backslash-escaped. Compound expressions that merely
/// start and end with a quote (`"a" + x + "b"`) are rejected — their interior holds an
/// unescaped quote — so folding never reaches across a dynamic piece.
fn is_string_literal(code: &str) -> bool {
    let b = code.as_bytes();
    if b.len() < 2 || b[0] != b'"' || b[b.len() - 1] != b'"' {
        return false;
    }
    let end = b.len() - 1;
    let mut i = 1;
    while i < end {
        match b[i] {
            b'\\' => i += 2, // an escape consumes the next byte, whatever it is
            b'"' => return false,
            _ => i += 1,
        }
    }
    // `i > end` means the trailing quote was consumed as an escape (`"a\"`), leaving the
    // literal unterminated rather than complete.
    i == end
}

/// Replace NUL-delimited slot placeholders (`\u{0}i\u{0}`) with branch calls.
fn substitute_branches(template: &str, calls: &[String]) -> String {
    let mut out = template.to_string();
    for (i, call) in calls.iter().enumerate() {
        out = out.replace(&format!("\u{0}{i}\u{0}"), call);
    }
    out
}

fn is_event(name: &str) -> bool {
    name.len() > 2 && name.starts_with("on")
}

/// Indent every non-empty line of `s` by `pad`.
fn indent(s: &str, pad: &str) -> String {
    s.lines()
        .map(|l| if l.is_empty() { String::new() } else { format!("{pad}{l}") })
        .collect::<Vec<_>>()
        .join("\n")
        + if s.is_empty() { "" } else { "\n" }
}

/// HTML-escape static text content (build-time).
fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// HTML-escape a static attribute value (build-time).
fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;")
}

/// A JS object key — bare when it's a valid identifier, else quoted.
fn js_object_key(s: &str) -> String {
    if !s.is_empty()
        && s.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    {
        s.to_string()
    } else {
        js_string(s)
    }
}

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
    use crate::parse::ParseSession;

    fn emit(source: &str, is_page: bool) -> SsgModule {
        let session = ParseSession::new();
        let path = if is_page { "/app/page.tsx" } else { "/app/App.tsx" };
        let parsed = session.parse(Path::new(path), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = crate::lower::lower_module(path, &parsed.program, source, is_page)
            .expect("lowered module");
        emit_module(&m.components, &m.module_stmts, &m.module_exprs)
    }

    #[test]
    fn data_position_jsx_in_list_source_renders_as_html_marker() {
        // `[{ icon: <b/> }].map(…)`: JSX in the list's data expression crosses to the
        // server as an `{ __html }` marker (like a JSX-valued prop), which `ssgText`
        // splices raw when the item reads it — never a raw JSX literal.
        let m = emit(
            "export default function P(){ return <ul>{[{icon: <b>ICON</b>}].map((t) => <li>{t.icon}</li>)}</ul>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("ssgList([{icon: { __html:"),
            "source __html marker:\n{}",
            m.code
        );
        assert!(m.code.contains("ssgText(t.value.icon)"), "item reads the marker:\n{}", m.code);
    }

    #[test]
    fn raw_text_elements_carry_no_hole_markers() {
        // Their content is not parsed as markup, so a `<!--$-->` would be served as those
        // literal characters — visible in the textarea, in the title, in the stylesheet.
        let m = emit(
            "export default function P(){ let v=$state(\"a\"); return <form>\
             <textarea>{v}</textarea><title>{v}</title><style>{v}</style></form>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(!m.code.contains("<!--$-->"), "no markers in raw text:\n{}", m.code);
        // Escapable raw text still resolves character references, so it is escaped;
        // `<style>`/`<script>` content is written verbatim (an entity would show through).
        assert!(m.code.contains("<textarea>\" + ssgText(v.value)"), "code:\n{}", m.code);
        assert!(m.code.contains("<style>\" + ssgRawText(v.value)"), "code:\n{}", m.code);
    }

    #[test]
    fn markup_inside_a_raw_text_element_is_rejected() {
        let m = emit(
            "export default function P(){ let v=$state(\"a\"); return <textarea><b>{v}</b></textarea>; }",
            true,
        );
        assert!(!m.is_complete());
        assert!(m.errors[0].contains("<textarea> can only contain text"), "{:?}", m.errors);
    }

    #[test]
    fn a_pre_hole_is_not_padded_with_a_newline() {
        // The parser eats one newline off a `<pre>` start tag, so serialized content that
        // begins with one gets a second (`ssg::element`). A hole never does: its `<!--$-->`
        // marker is what follows the tag, and a comment is not a newline. Padding anyway
        // would insert a blank first line into every server-rendered `<pre>`.
        let m = emit("export default function P(){ let v=$state(\"x\"); return <pre>{v}</pre>; }", true);
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("\"<pre><!--$-->\""), "code:\n{}", m.code);
    }

    #[test]
    fn page_emits_html_string_builder() {
        let m = emit(
            "export default function P(){ let n=$state(3); return <div class=\"box\"><h1>Count {n}</h1></div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("export default function ()"), "code:\n{}", m.code);
        assert!(m.code.contains("const n = signal(3);"), "code:\n{}", m.code);
        // Static markup is a string literal; the dynamic hole goes through ssgText.
        // Adjacent static fragments are folded, so the open tag carries the nested
        // static markup up to the hole rather than sitting in its own literal.
        assert!(m.code.contains("\"<div class=\\\"box\\\"><h1>Count "), "code:\n{}", m.code);
        assert!(m.code.contains("ssgText(n.value)"), "code:\n{}", m.code);
        // No DOM, no effects, no lifecycle in SSG output.
        assert!(!m.code.contains("document."), "no DOM:\n{}", m.code);
        assert!(!m.code.contains("effect("), "no effects:\n{}", m.code);
        assert!(!m.code.contains("addEventListener"), "no events:\n{}", m.code);
    }

    #[test]
    fn ssg_strips_dom_hooks() {
        // `onResize`/`onVisibilityChange`/`onMediaQuery` are dropped in lowering
        // (`is_lifecycle_stmt`), so nothing observer-shaped reaches SSG output.
        let m = emit(
            "export default function P(){ onResize((e) => console.log(e)); onVisibilityChange((v) => console.log(v)); onMediaQuery(\"(min-width: 768px)\", (q) => console.log(q)); return <div>hi</div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        for needle in ["ResizeObserver", "IntersectionObserver", "matchMedia", "onResize"] {
            assert!(!m.code.contains(needle), "{needle} leaked into SSG:\n{}", m.code);
        }
    }

    #[test]
    fn dynamic_text_hole_carries_hydration_markers() {
        // The value is bracketed by <!--$-->…<!--/--> so the client Hydrate backend can
        // claim the text node even when empty/adjacent to static text (docs/HYDRATION.md).
        let m = emit("export default function P(){ let n=$state(1); return <p>x {n}</p>; }", true);
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // The opening marker folds into the preceding static text; the closing one folds
        // into the closing tag. What must survive is the bracketing around `ssgText`.
        assert!(
            m.code.contains("x <!--$-->\" + ssgText(n.value) + \"<!--/-->"),
            "markers:\n{}",
            m.code
        );
    }

    #[test]
    fn list_and_dynamic_attr() {
        let m = emit(
            "export default function P(){ return <ul>{[1,2,3].map(x => <li id={x}>item {x}</li>)}</ul>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("ssgList([1,2,3]"), "code:\n{}", m.code);
        assert!(m.code.contains("const x = { value:"), "item reified:\n{}", m.code);
        assert!(m.code.contains("attr(\"id\", x.value)"), "dyn attr:\n{}", m.code);
    }

    #[test]
    fn component_registers_and_wraps_props() {
        let m = emit(
            "export default function Counter(props){ let n=$state(0); return <button class={[\"btn\", n>0 && \"on\"]}>{props.label}</button>; }",
            false,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("function Counter_ssg(__props, __children)"), "fn:\n{}", m.code);
        // The render fn carries a module-namespaced tag and registers under it.
        assert!(m.code.contains("Counter_ssg.tag = \"web-counter-"), "tag:\n{}", m.code);
        assert!(m.code.contains("defineSSG(Counter_ssg.tag, Counter_ssg)"), "register:\n{}", m.code);
        assert!(m.code.contains("__props?.[\"label\"]"), "prop wrap:\n{}", m.code);
        assert!(m.code.contains("attr(\"class\", [\"btn\", n.value>0"), "class array:\n{}", m.code);
        // Fail-soft like CSR's connectedCallback try/catch.
        assert!(m.code.contains("catch (e) { return \"\"; }"), "fail soft:\n{}", m.code);
    }

    #[test]
    fn child_component_composes_via_registry() {
        let m = emit(
            "import Counter from \"../components/Counter\"; export default function P(){ return <div><Counter label=\"hi\"/></div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("ssgComponent(Counter.tag, { label: \"hi\" }"),
            "compose:\n{}",
            m.code
        );
    }

    #[test]
    fn valueless_component_prop_serializes_boolean_true() {
        let m = emit(
            "import Toggle from \"../components/Toggle\"; export default function P(){ return <div><Toggle disabled/></div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // A valueless boolean prop crosses to the component as `true`, not `""`.
        assert!(
            m.code.contains("ssgComponent(Toggle.tag, { disabled: true }"),
            "compose:\n{}",
            m.code
        );
    }

    #[test]
    fn page_destructures_children_and_props() {
        // `function L({ children, params })` → synthesized __props param, children as
        // the slot, other keys aliased.
        let m = emit(
            "export default function L({ children, params }) { return <main>{children}{params.id}</main>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("export default function (__props)"), "param:\n{}", m.code);
        assert!(m.code.contains("const params = __props.params;"), "alias:\n{}", m.code);
        assert!(m.code.contains("(__props?.children ?? \"\")"), "children slot:\n{}", m.code);
        assert!(m.code.contains("ssgText(params.id)"), "alias used:\n{}", m.code);
    }

    #[test]
    fn member_expression_component_is_rejected() {
        let m = emit("export default function P(){ return <Foo.Bar/>; }", true);
        assert!(!m.is_complete());
        assert!(m.errors.iter().any(|e| e.contains("Foo.Bar")), "errors: {:?}", m.errors);
    }

    #[test]
    fn void_element_has_no_closing_tag() {
        let m = emit("export default function P(){ return <img src=\"/a.png\"/>; }", true);
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("\"<img src=\\\"/a.png\\\">\""), "code:\n{}", m.code);
        assert!(!m.code.contains("</img>"), "no closing tag:\n{}", m.code);
    }

    #[test]
    fn static_subtree_folds_to_one_literal() {
        // A fully static tree carries no `+` at all: every fragment merges into a single
        // literal. This is what keeps the bundler's parse tree shallow on large pages.
        let m = emit(
            "export default function P(){ return <div class=\"a\"><h1>Hi</h1><p>Body <b>bold</b></p></div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("return \"<div class=\\\"a\\\"><h1>Hi</h1><p>Body <b>bold</b></p></div>\";"),
            "single literal:\n{}",
            m.code
        );
    }

    #[test]
    fn folding_stops_at_dynamic_pieces() {
        // Static runs on either side of a hole collapse, but the hole still separates
        // them — folding must never merge across a non-literal piece.
        let m = emit(
            "export default function P(){ let n=$state(0); return <div><b>a</b>{n}<i>b</i></div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("\"<div><b>a</b><!--$-->\" + ssgText(n.value) + \"<!--/--><i>b</i></div>\""),
            "folds up to the hole only:\n{}",
            m.code
        );
    }

    #[test]
    fn folding_preserves_escapes_across_the_merge() {
        // Merging is textual, so a literal ending in an escape must not be mistaken for
        // an unterminated one, and quotes/backslashes must survive intact.
        assert!(is_string_literal("\"a\\\\\""), "trailing backslash escape is a literal");
        assert!(!is_string_literal("\"a\\\""), "unterminated literal");
        assert!(!is_string_literal("\"a\" + x + \"b\""), "compound expression");
        assert!(!is_string_literal("attr(\"id\", x)"), "call expression");
        assert_eq!(
            join_plus(&["\"a\\\\\"".to_string(), "\"\\\"b\"".to_string()]),
            "\"a\\\\\\\"b\"",
            "escapes survive the merge"
        );
    }
}
