//! Hydrate backend (Phase 2 — see `docs/HYDRATION.md`). Sibling to `csr.rs`/`ssg.rs`.
//!
//! Where CSR *builds* the DOM (`document.createElement` + `appendChild`), Hydrate
//! *adopts* the server-rendered DOM: the emitted code walks the existing nodes with a
//! cursor and `claim`s them by position, never creating structure. The **reactivity
//! wiring is the same runtime** as CSR — `bindText`, `bindAttr`, event listeners,
//! `effect` — so this backend reuses `csr.rs`'s leaf emitters (`js_string`, event
//! handling) and only the node-acquisition walk is new (the design's "differ only in
//! node acquisition"). Markers (`<!--$-->…<!--/-->`) delimit dynamic text holes; static
//! structure is claimed by position (no markers).
//!
//! Scope (Phase 2.0): **pages / layouts** with element / static-text / dynamic-text
//! structure, static & dynamic attributes, `ref`, and event handlers. Child components,
//! lists, conditionals (`DynamicNode`), `{children}` slots, fragment/non-element roots,
//! and JSX-as-value are reported as diagnostics and land in 2.1+.

use otfw_ir::reactivity::SignalKind;
use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::ExpressionId;

use crate::codegen::csr::{self, event_options, is_event, is_listener, js_string};
use crate::lower::{BodyItem, ExprTable, Lowered, SignalDecl};

/// The Hydrate output for a module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HydrateModule {
    pub code: String,
    pub errors: Vec<String>,
}

impl HydrateModule {
    pub fn is_complete(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Which hydrate-exclusive claim helpers the generated factory references (drives the
/// appended import; the reactive helpers come from the CSR part's import — see
/// `claim_import`).
#[derive(Default)]
struct Uses {
    cursor: bool,
    claim_element: bool,
    claim_text: bool,
    skip_node: bool,
}

/// Emit a whole module for the **hydrate target**: the full CSR module (build
/// factories + Custom Elements + registrations — used for client-side navigation,
/// where there is no server DOM to adopt) **plus** a `hydrate` adopt factory per page
/// (used on first paint to adopt the server-rendered DOM).
///
/// The two share a module scope, so the appended hydrate factory references the same
/// signal/decl helpers the CSR part already imported; only the hydrate-exclusive claim
/// helpers (`cursor`/`claimElement`/`claimText`/`skipNode`) need a fresh import (no
/// identifier overlap). A page the adopt walk can't handle yet (child components,
/// lists, conditionals, `{children}`) simply gets **no** `hydrate` export — it still
/// works via CSR (the router falls back to a build), so the diagnostics are warnings.
pub fn emit_module(
    components: &[Lowered],
    module_stmts: &[BodyItem],
    module_exprs: &ExprTable,
) -> HydrateModule {
    // 1. The complete CSR module — build factories + components + `customElements.define`.
    let base = csr::emit_module(components, module_stmts, module_exprs);
    let mut code = base.code;
    let mut errors = base.errors;

    // 2. Append an adopt (`hydrate`) factory for every page we can adopt.
    let mut uses = Uses::default();
    let mut bodies = Vec::new();
    for c in components {
        if !c.is_page {
            continue; // component (custom-element) adoption is Phase 2.1
        }
        let mut e = Emitter::new(&c.exprs);
        let body = e.page(c);
        if e.errors.is_empty() {
            merge_uses(&mut uses, &e.uses);
            bodies.push(body);
        } else {
            // Can't adopt this page yet — emit CSR-only (no `hydrate` export) and report
            // the reason as a (non-fatal) warning. The page still renders + works.
            errors.extend(e.errors);
        }
    }

    if !bodies.is_empty() {
        if !code.ends_with('\n') {
            code.push('\n');
        }
        code.push_str(&claim_import(&uses));
        for body in bodies {
            code.push_str(&body);
        }
    }
    HydrateModule { code, errors }
}

fn merge_uses(into: &mut Uses, from: &Uses) {
    into.cursor |= from.cursor;
    into.claim_element |= from.claim_element;
    into.claim_text |= from.claim_text;
    into.skip_node |= from.skip_node;
}

/// Import only the hydrate-exclusive claim helpers. The reactive helpers the adopt
/// factory uses (`signal`/`computed`/`effect`/`bindText`/`bindAttr`/`readContext`) are
/// a subset of what the CSR part already imported for the same view, so re-importing
/// them would clash; the claim helpers never appear in CSR output, so they are safe.
fn claim_import(uses: &Uses) -> String {
    let mut names = Vec::new();
    if uses.cursor {
        names.push("cursor");
    }
    if uses.claim_element {
        names.push("claimElement");
    }
    if uses.claim_text {
        names.push("claimText");
    }
    if uses.skip_node {
        names.push("skipNode");
    }
    if names.is_empty() {
        return String::new();
    }
    format!("import {{ {} }} from \"@opentf/web\";\n", names.join(", "))
}

struct Emitter<'a> {
    exprs: &'a ExprTable,
    lines: Vec<String>,
    errors: Vec<String>,
    counter: u32,
    uses: Uses,
}

impl<'a> Emitter<'a> {
    fn new(exprs: &'a ExprTable) -> Self {
        Self {
            exprs,
            lines: Vec::new(),
            errors: Vec::new(),
            counter: 0,
            uses: Uses::default(),
        }
    }

    fn fresh(&mut self, prefix: &str) -> String {
        let name = format!("{prefix}{}", self.counter);
        self.counter += 1;
        name
    }

    fn line(&mut self, stmt: String) {
        self.lines.push(stmt);
    }

    fn code(&self, id: ExpressionId) -> String {
        self.exprs.code(id).unwrap_or("undefined").to_string()
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

    // ── the page shell ────────────────────────────────────────────────────────

    /// Emit a page/layout as a hydrate factory: `function (__root, props) { … }`. The
    /// router passes the container whose existing children are the server-rendered
    /// view; the factory adopts them and returns the claimed root node.
    fn page(&mut self, lowered: &Lowered) -> String {
        if !lowered.props.is_empty() {
            self.errors.push("hydrate: page/factory props not supported yet".into());
        }
        for item in lowered.body.clone() {
            self.emit_decl_item(&item);
        }

        // Adopt the view from a cursor over the container's children.
        let cur = self.fresh("__c");
        self.uses.cursor = true;
        self.line(format!("const {cur} = cursor(__root);"));
        let root = self.emit_node(&cur, &lowered.ir.view);

        // Top-level $effect callbacks run for the page's lifetime (page disposal: none).
        for cb in lowered.effects.clone() {
            self.line(format!("effect({cb});"));
        }

        // Lifecycle: attach an `__lifecycle` record to the root so the router runs
        // onMount after adoption and onCleanup teardown on navigation (mirrors CSR).
        if !lowered.on_mounts.is_empty() || !lowered.on_cleanups.is_empty() {
            self.line("const __lifecycle = { mounts: [], cleanups: [] };".into());
            for cb in &lowered.on_cleanups {
                self.line(format!("__lifecycle.cleanups.push({cb});"));
            }
            for cb in &lowered.on_mounts {
                self.line(format!("__lifecycle.mounts.push({cb});"));
            }
            self.line(format!("{root}.__lifecycle = __lifecycle;"));
        }

        let param = lowered.page_param.as_deref().unwrap_or("");
        let params = if param.is_empty() {
            "__root".to_string()
        } else {
            format!("__root, {param}")
        };
        // A named `hydrate` export living alongside the CSR `export default` build
        // factory. The router calls `hydrate(container, props)` on first paint and the
        // default factory on client navigation. A non-default page namespaces the name.
        let export = &lowered.ir.id.export;
        let name = if export == "default" {
            "hydrate".to_string()
        } else {
            format!("hydrate_{export}")
        };
        format!(
            "export function {name}({params}) {{\n{}  return {root};\n}}\n",
            self.render("  ")
        )
    }

    fn emit_decl_item(&mut self, item: &BodyItem) {
        match item {
            BodyItem::Signal(decl) => self.emit_decl(decl),
            BodyItem::Raw(stmt) => self.line(stmt.clone()),
            BodyItem::Jsx { .. } => {
                self.errors.push("hydrate: JSX-as-value is not supported yet (Phase 2.1)".into());
            }
        }
    }

    fn emit_decl(&mut self, decl: &SignalDecl) {
        match decl.kind {
            SignalKind::State => {
                self.line(format!("const {} = signal({});", decl.name, decl.init));
            }
            SignalKind::Ref => {
                self.line(format!("const {} = signal(null);", decl.name));
            }
            SignalKind::Context => {
                self.line(format!("const {} = readContext({});", decl.name, decl.init));
            }
            SignalKind::Derived => {
                let body = if decl.init_is_fn {
                    decl.init.clone()
                } else {
                    format!("() => {}", decl.init)
                };
                self.line(format!("const {} = computed({});", decl.name, body));
            }
            SignalKind::Prop => {
                self.errors.push(format!("hydrate: prop signal not supported yet: {}", decl.name));
            }
        }
    }

    // ── the adopt walk ────────────────────────────────────────────────────────

    /// Claim `node` from cursor `cur` (advancing it) and return the variable holding
    /// the claimed node. Recurses into element children with a fresh child cursor.
    fn emit_node(&mut self, cur: &str, node: &ViewNode) -> String {
        match node {
            ViewNode::Element { tag, props, children } => {
                let var = self.fresh("el");
                self.uses.claim_element = true;
                self.line(format!("const {var} = claimElement({cur}, {});", js_string(tag)));
                for prop in props {
                    self.emit_prop(&var, prop);
                }
                if !children.is_empty() {
                    let child_cur = self.fresh("__c");
                    self.uses.cursor = true;
                    self.line(format!("const {child_cur} = cursor({var});"));
                    for child in children {
                        self.emit_node(&child_cur, child);
                    }
                }
                var
            }
            // Static text: a real text node in the server HTML — step the cursor over
            // it (no binding). The `_` keeps the walk aligned for following siblings.
            ViewNode::Text(_) => {
                self.uses.skip_node = true;
                self.line(format!("skipNode({cur});"));
                String::new()
            }
            // Dynamic text hole: claim the `<!--$-->…<!--/-->` text node and wire it.
            ViewNode::Dynamic { expr } => {
                let var = self.fresh("t");
                self.uses.claim_text = true;
                self.line(format!("const {var} = claimText({cur});"));
                self.line(format!("bindText({var}, () => ({}));", self.code(*expr)));
                var
            }
            unsupported => {
                self.errors.push(format!(
                    "hydrate: {} is not supported yet (Phase 2.1)",
                    node_kind(unsupported)
                ));
                String::new()
            }
        }
    }

    /// Wire a prop onto an already-claimed element. Static attributes are already in
    /// the server HTML, so they are **skipped**; only dynamic attributes, events, and
    /// `ref` produce code.
    fn emit_prop(&mut self, el: &str, prop: &Prop) {
        if prop.name == "ref" {
            if let PropValue::Dynamic(expr) = &prop.value {
                self.line(format!("{}.value = {el};", self.code(*expr)));
            }
            return;
        }
        if prop.name.is_empty() {
            self.errors.push("hydrate: spread props are not supported yet (Phase 2.1)".into());
            return;
        }
        match &prop.value {
            // Already serialized into the server HTML — nothing to do on the client.
            PropValue::Static(_) => {}
            PropValue::Dynamic(expr) => {
                let code = self.code(*expr);
                if is_listener(&prop.name) {
                    let (event, opts) = event_options(&prop.name);
                    // A page's node lives for the app's lifetime, so the listener needs
                    // no teardown (mirrors CSR's page path).
                    self.line(format!(
                        "{el}.addEventListener({}, {code}{opts});",
                        js_string(&event)
                    ));
                } else if is_event(&prop.name) {
                    self.line(format!("{el}.{} = {code};", prop.name.to_ascii_lowercase()));
                } else {
                    self.line(format!(
                        "bindAttr({el}, {}, () => ({code}));",
                        js_string(&prop.name)
                    ));
                }
            }
            PropValue::DynamicNode { .. } => {
                self.errors
                    .push("hydrate: JSX-valued props are not supported yet (Phase 2.1)".into());
            }
        }
    }
}

fn node_kind(node: &ViewNode) -> &'static str {
    match node {
        ViewNode::Component { .. } => "child component",
        ViewNode::List { .. } => "list (`array.map`)",
        ViewNode::DynamicNode { .. } => "conditional / dynamic node region",
        ViewNode::Children => "`{children}` slot",
        ViewNode::Fragment(_) => "fragment / multi-node root",
        _ => "this construct",
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::lower::lower_module;
    use crate::parse::ParseSession;

    fn emit(source: &str) -> HydrateModule {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("/app/page.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = lower_module("/app/page.tsx", &parsed.program, source, true).expect("lowered");
        emit_module(&m.components, &m.module_stmts, &m.module_exprs)
    }

    /// The appended `export function hydrate(...) { … }` factory (or "" if none).
    fn hydrate_fn(code: &str) -> String {
        match code.find("export function hydrate") {
            Some(i) => code[i..].to_string(),
            None => String::new(),
        }
    }

    #[test]
    fn dual_emit_pairs_a_csr_build_factory_with_a_hydrate_adopt_factory() {
        let m = emit(
            "export default function P(){ let n=$state(3); return <div class=\"box\"><h1>Count {n}</h1></div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // CSR part — the build factory used for client-side navigation.
        assert!(m.code.contains("export default function ()"), "csr factory:\n{}", m.code);
        assert!(m.code.contains("document.createElement(\"div\")"), "csr builds:\n{}", m.code);
        // The hydrate-exclusive claim helpers get their own (non-overlapping) import.
        assert!(
            m.code.contains("import { cursor, claimElement, claimText, skipNode } from \"@opentf/web\";"),
            "claim import:\n{}",
            m.code
        );

        // Adopt part — the hydrate factory never creates structure.
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("export function hydrate(__root)"), "hydrate shape:\n{}", hyd);
        assert!(hyd.contains("const __c0 = cursor(__root);"), "root cursor:\n{}", hyd);
        assert!(hyd.contains("const el1 = claimElement(__c0, \"div\");"), "claim div:\n{}", hyd);
        assert!(hyd.contains("claimElement(__c2, \"h1\");"), "claim h1:\n{}", hyd);
        assert!(hyd.contains("skipNode(__c4);"), "skip static text:\n{}", hyd);
        assert!(hyd.contains("const t5 = claimText(__c4);"), "claim text hole:\n{}", hyd);
        assert!(hyd.contains("bindText(t5, () => (n.value));"), "wire text:\n{}", hyd);
        assert!(!hyd.contains("createElement"), "adopt creates no nodes:\n{}", hyd);
        assert!(!hyd.contains("appendChild"), "adopt appends nothing:\n{}", hyd);
        assert!(!hyd.contains("setAttribute"), "static attr skipped on adopt:\n{}", hyd);
    }

    #[test]
    fn dynamic_attribute_and_event_wire_onto_claimed_element() {
        let m = emit(
            "export default function P(){ let on=$state(false); return <button class={on ? \"on\" : \"\"} onclick={() => on = !on}>go</button>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("claimElement(__c0, \"button\");"), "claim button:\n{}", hyd);
        assert!(hyd.contains("bindAttr(el1, \"class\","), "dyn attr:\n{}", hyd);
        assert!(hyd.contains("el1.onclick = () => on.value = !on.value;"), "event:\n{}", hyd);
        assert!(hyd.contains("skipNode("), "static 'go' text skipped:\n{}", hyd);
    }

    #[test]
    fn listener_modifier_uses_add_event_listener() {
        let m = emit(
            "export default function P(){ return <div onscroll:passive={() => {}}>x</div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(
            hyd.contains("el1.addEventListener(\"scroll\", () => {}, { passive: true });"),
            "listener:\n{}",
            hyd
        );
    }

    #[test]
    fn unadoptable_page_emits_csr_only_with_a_warning() {
        // A page composing a child component can't be adopted yet: emit the CSR build
        // factory (so it still works) but *no* `hydrate` export, and warn.
        let m = emit(
            "import Counter from \"./Counter\"; export default function P(){ return <div><Counter/></div>; }",
        );
        assert!(m.code.contains("export default function ()"), "csr factory present:\n{}", m.code);
        assert!(!m.code.contains("export function hydrate"), "no hydrate export:\n{}", m.code);
        assert!(m.errors.iter().any(|e| e.contains("child component")), "warning: {:?}", m.errors);
    }

    #[test]
    fn list_page_emits_csr_only_with_a_warning() {
        let m = emit(
            "export default function P(){ return <ul>{[1,2,3].map(x => <li>{x}</li>)}</ul>; }",
        );
        assert!(!m.code.contains("export function hydrate"), "no hydrate export:\n{}", m.code);
        assert!(m.errors.iter().any(|e| e.contains("list")), "warning: {:?}", m.errors);
    }
}
