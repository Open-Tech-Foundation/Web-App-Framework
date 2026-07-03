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

use crate::codegen::tags;
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

    fn html_expr(&mut self, node: &ViewNode) -> String {
        match node {
            ViewNode::Text(text) => js_string(&escape_text(text)),
            ViewNode::Element { tag, props, children } => self.element(tag, props, children),
            ViewNode::Dynamic { expr } => {
                self.server.insert("ssgText");
                // Hydration text-hole markers (docs/HYDRATION.md §3.1): bracket the value
                // with `<!--$-->…<!--/-->` so the client can claim the text node even when
                // it is empty or adjacent to static text (the HTML parser would otherwise
                // merge them). Inert for plain SSG output (just an HTML comment).
                format!("\"<!--$-->\" + ssgText({}) + \"<!--/-->\"", self.code(*expr))
            }
            ViewNode::Component { name, props, children } => self.component_use(name, props, children),
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
                format!(
                    "\"<!--[-->\" + ssgText({}) + \"<!--]-->\"",
                    substitute_branches(&template, &calls)
                )
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
                    format!("\"<!--[-->\" + {inner} + \"<!--]-->\"")
                } else {
                    // A component's light-DOM `{children}` — not hydratable yet (the component
                    // falls back to rebuild), so no markers.
                    "(__children ?? \"\")".to_string()
                }
            }
            ViewNode::List { source, item_param, index_param, item, key: _ } => {
                self.list(*source, item_param, index_param.as_deref(), item)
            }
            ViewNode::Fragment(children) => self.concat(children),
        }
    }

    fn element(&mut self, tag: &str, props: &[Prop], children: &[ViewNode]) -> String {
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
        if VOID.contains(&tag) {
            pieces.push(js_string(">"));
            return join_plus(&pieces);
        }
        pieces.push(js_string(">"));
        pieces.push(self.concat(children));
        pieces.push(js_string(&format!("</{tag}>")));
        join_plus(&pieces)
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
                PropValue::Dynamic(id) => format!("({})", self.code(*id)),
                PropValue::DynamicNode { expr, branches } => {
                    format!("({})", self.node_prop_code(*expr, branches))
                }
            };
            entries.push(format!("{}: {}", js_object_key(&p.name), val));
        }
        let props_obj = format!("{{ {} }}", entries.join(", "));
        let children_html = self.concat(children);
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
        item_param: &str,
        index_param: Option<&str>,
        item: &ViewNode,
    ) -> String {
        let n = self.fresh();
        let item_html = self.html_expr(item);
        let idx_decl = match index_param {
            Some(idx) => format!("const {idx} = __idx{n}; "),
            None => String::new(),
        };
        self.server.insert("ssgList");
        // Bracket the list with region markers (docs/HYDRATION.md §3.1) so the client can
        // find the variable region's boundary to reconcile from N. The closing `<!--]-->`
        // becomes the reconcile anchor on hydration; static SSG output treats them as inert
        // comments. Each item renders to one root node (bare-text items keep their own
        // `<!--$-->…<!--/-->` markers), so no per-item separator is needed.
        format!(
            "\"<!--[-->\" + ssgList({}, (__it{n}, __idx{n}) => {{ const {item_param} = {{ value: __it{n} }}; {idx_decl}return {item_html}; }}) + \"<!--]-->\"",
            self.code(source),
            n = n,
            item_param = item_param,
            item_html = item_html,
            idx_decl = idx_decl,
        )
    }

    /// Concatenate a list of child nodes into one HTML-string expression.
    fn concat(&mut self, children: &[ViewNode]) -> String {
        let parts: Vec<String> = children.iter().map(|c| self.html_expr(c)).collect();
        if parts.is_empty() {
            "\"\"".to_string()
        } else {
            join_plus(&parts)
        }
    }
}

/// Join JS expression pieces with `+`, dropping empty-string literals.
fn join_plus(parts: &[String]) -> String {
    let kept: Vec<&String> = parts.iter().filter(|p| p.as_str() != "\"\"").collect();
    if kept.is_empty() {
        return "\"\"".to_string();
    }
    kept.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" + ")
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
    fn page_emits_html_string_builder() {
        let m = emit(
            "export default function P(){ let n=$state(3); return <div class=\"box\"><h1>Count {n}</h1></div>; }",
            true,
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("export default function ()"), "code:\n{}", m.code);
        assert!(m.code.contains("const n = signal(3);"), "code:\n{}", m.code);
        // Static markup is a string literal; the dynamic hole goes through ssgText.
        assert!(m.code.contains("\"<div class=\\\"box\\\"\""), "code:\n{}", m.code);
        assert!(m.code.contains("ssgText(n.value)"), "code:\n{}", m.code);
        // No DOM, no effects, no lifecycle in SSG output.
        assert!(!m.code.contains("document."), "no DOM:\n{}", m.code);
        assert!(!m.code.contains("effect("), "no effects:\n{}", m.code);
        assert!(!m.code.contains("addEventListener"), "no events:\n{}", m.code);
    }

    #[test]
    fn dynamic_text_hole_carries_hydration_markers() {
        // The value is bracketed by <!--$-->…<!--/--> so the client Hydrate backend can
        // claim the text node even when empty/adjacent to static text (docs/HYDRATION.md).
        let m = emit("export default function P(){ let n=$state(1); return <p>x {n}</p>; }", true);
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("\"<!--$-->\" + ssgText(n.value) + \"<!--/-->\""),
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
        assert!(m.code.contains("\"<img src=\\\"/a.png\\\"\""), "code:\n{}", m.code);
        assert!(!m.code.contains("</img>"), "no closing tag:\n{}", m.code);
    }
}
