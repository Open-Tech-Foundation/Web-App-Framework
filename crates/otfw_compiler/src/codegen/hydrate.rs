//! Hydrate backend (Phase 2 — see `docs/HYDRATION.md`). Sibling to `csr.rs`/`ssg.rs`.
//!
//! Where CSR *builds* the DOM (`document.createElement` + `appendChild`), Hydrate
//! *adopts* the server-rendered DOM: the emitted code walks the existing nodes with a
//! cursor and `claim`s them by position, never creating structure. The **reactivity
//! wiring is the same runtime** as CSR — `bindText`, `bindAttr`, event listeners,
//! `effect`, `setProp` — so this backend reuses `csr.rs`'s leaf emitters and only the
//! node-acquisition walk is new. Markers (`<!--$-->…<!--/-->`) delimit dynamic text
//! holes; static structure is claimed by position (no markers).
//!
//! Output shape (`docs/HYDRATION.md` §0): the hydrate target is a **single client
//! bundle that both adopts (first paint) and builds (SPA navigation)**. Pages get the
//! CSR `export default` build factory **plus** a named `hydrate` adopt factory.
//! Components get a **dual class**: csr emits the class, but its `connectedCallback`
//! branches on `isHydrating() && this.firstChild` (first-paint hydration over server DOM
//! ⇒ adopt; client navigation ⇒ build). The global flag is the discriminator because
//! `this.firstChild` alone can't tell a server-rendered host from a client-`createElement`'d
//! one that was handed call-site children (§3.4). csr stays a build-only backend — it only
//! splices the adopt body this module hands it (`ComponentView::Adopt`) behind the switch
//! (plus the mismatch-recovery scaffold); the adopt body itself is emitted here. Variable
//! regions bracket their server output with `<!--[-->…<!--]-->`: keyed **lists** adopt via
//! `hydrateList` (an adopt-item walk + a CSR build-item fn seed the reconcile), and
//! **conditionals** adopt via `hydrateChild` (an adopt fn claims the rendered branch, a CSR
//! build fn swaps it on change) — Phase 2.1. A view this backend can't adopt yet
//! (`{children}` slots, fragments) falls back: pages get no `hydrate` export (the router
//! rebuilds via CSR); components get `ComponentView::RebuildIfServerChildren` (discard
//! server DOM + build).

use otfw_ir::reactivity::SignalKind;
use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::ExpressionId;

use crate::codegen::csr::{
    self, emit_build_item_fn, emit_build_node_fn, event_options, is_event, is_listener, js_string,
    substitute_branches_pub, ComponentView,
};
use crate::codegen::tags;
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

/// Which hydrate-exclusive claim helpers the generated code references (drives the
/// appended import). The reactive helpers (`signal`/`effect`/`bindText`/`setProp`/…)
/// come from the CSR part's import — the adopt code is the *same view* as the build
/// code, so its reactive-helper needs are a subset already imported.
#[derive(Default)]
struct Uses {
    cursor: bool,
    claim_element: bool,
    claim_text: bool,
    skip_node: bool,
    hydrate_list: bool,
    hydrate_child: bool,
}

fn merge_uses(into: &mut Uses, from: &Uses) {
    into.cursor |= from.cursor;
    into.claim_element |= from.claim_element;
    into.claim_text |= from.claim_text;
    into.skip_node |= from.skip_node;
    into.hydrate_list |= from.hydrate_list;
    into.hydrate_child |= from.hydrate_child;
}

/// Emit a whole module for the **hydrate target**. Calls `csr` to emit the build
/// factories + Custom Elements + registrations, threading a [`ComponentView`] per
/// component so each class's `connectedCallback` adopts when server-rendered; then
/// appends the page `hydrate` adopt factories and the claim-helper import.
pub fn emit_module(
    components: &[Lowered],
    module_stmts: &[BodyItem],
    module_exprs: &ExprTable,
) -> HydrateModule {
    let mut uses = Uses::default();
    let mut errors = Vec::new();

    // 1. Per-component adopt bodies (spliced into the csr class by `ComponentView`).
    //    Each entry aligns with `components` by index; pages get `Build` (ignored —
    //    they use a separate `hydrate` factory, below). Owned strings live here so the
    //    `ComponentView::Adopt(&str)` borrows stay valid through the csr call.
    let mut adopt_bodies: Vec<Option<String>> = Vec::with_capacity(components.len());
    for c in components {
        if c.is_page {
            adopt_bodies.push(None);
            continue;
        }
        let mut e = Emitter::new(c, Some("this._cleanups"));
        let body = e.component_adopt(c);
        if e.errors.is_empty() {
            merge_uses(&mut uses, &e.uses);
            adopt_bodies.push(Some(body));
        } else {
            // Can't adopt this component's view yet → `RebuildIfServerChildren`: discard the
            // server DOM and build (a flash, but no double-render). Report why (non-fatal).
            errors.extend(e.errors);
            adopt_bodies.push(None);
        }
    }
    let views: Vec<ComponentView> = components
        .iter()
        .zip(&adopt_bodies)
        .map(|(c, body)| {
            if c.is_page {
                ComponentView::Build
            } else if let Some(b) = body {
                ComponentView::Adopt(b)
            } else {
                ComponentView::RebuildIfServerChildren
            }
        })
        .collect();

    let base = csr::emit_module_with_adopt(components, module_stmts, module_exprs, &views);
    let mut code = base.code;
    errors.extend(base.errors);

    // 2. Append a `hydrate` adopt factory for every page we can adopt.
    let mut page_bodies = Vec::new();
    for c in components {
        if !c.is_page {
            continue;
        }
        // Sink into a local `__disposers` list: on success the page's effects live for its
        // lifetime (never disposed here), but if the adopt walk throws a `HydrationMismatch`
        // partway, the factory disposes what it already wired before rethrowing — so the
        // router's fallback CSR rebuild doesn't leave orphaned effects double-subscribed
        // (issue 6). The page node itself is discarded on navigation, as before.
        let mut e = Emitter::new(c, Some("__disposers"));
        let body = e.page(c);
        if e.errors.is_empty() {
            merge_uses(&mut uses, &e.uses);
            page_bodies.push(body);
        } else {
            errors.extend(e.errors);
        }
    }

    if !code.ends_with('\n') {
        code.push('\n');
    }
    code.push_str(&claim_import(&uses));
    for body in page_bodies {
        code.push_str(&body);
    }
    HydrateModule { code, errors }
}

/// Import only the hydrate-exclusive claim helpers (the reactive helpers are already
/// imported by the CSR part). Safe to append after all code — ES imports hoist, so the
/// bindings are live when `customElements.define` upgrades a server element mid-module.
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
    if uses.hydrate_list {
        names.push("hydrateList");
    }
    if uses.hydrate_child {
        names.push("hydrateChild");
    }
    if names.is_empty() {
        return String::new();
    }
    format!("import {{ {} }} from \"@opentf/web\";\n", names.join(", "))
}

struct Emitter<'a> {
    lowered: &'a Lowered,
    lines: Vec<String>,
    errors: Vec<String>,
    counter: u32,
    uses: Uses,
    /// Disposal sink for effects/listeners/cleanups: `Some("this._cleanups")` in a
    /// component (collected, removed on disconnect) or `Some("__disposers")` in a page
    /// (collected only so a mid-walk `HydrationMismatch` can dispose the partial wiring
    /// before the router rebuilds — on success the page's effects live for its lifetime).
    /// `None` inlines with no disposer collection (unused for the emitted factories).
    sink: Option<&'static str>,
    /// Prefix for generated list adopt/build item functions (the component export name),
    /// mirroring `csr`'s `base` so names are stable and collision-free.
    base: String,
    /// Monotonic counter for unique list item-function names within a factory scope.
    list_counter: u32,
}

impl<'a> Emitter<'a> {
    fn new(lowered: &'a Lowered, sink: Option<&'static str>) -> Self {
        Self {
            lowered,
            lines: Vec::new(),
            errors: Vec::new(),
            counter: 0,
            uses: Uses::default(),
            sink,
            base: lowered.ir.id.export.clone(),
            list_counter: 0,
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

    /// Push an effect-returning call, collecting its disposer in a component.
    fn bind(&mut self, call: String) {
        match self.sink {
            Some(sink) => self.line(format!("{sink}.push({call});")),
            None => self.line(format!("{call};")),
        }
    }

    fn code(&self, id: ExpressionId) -> String {
        self.lowered.exprs.code(id).unwrap_or("undefined").to_string()
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

    // ── the page shell ──────────────────────────────────────────────────────────

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
            self.bind(format!("effect({cb})"));
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
        let export = &lowered.ir.id.export;
        let name = if export == "default" {
            "hydrate".to_string()
        } else {
            format!("hydrate_{export}")
        };
        // Dispose the effects wired so far if the adopt walk throws a `HydrationMismatch`
        // partway (issue 6): the router catches the throw and rebuilds via CSR, so without
        // this the partial page's `bindText`/`bindAttr`/`effect` subscriptions would leak
        // and double up against the rebuild.
        format!(
            "export function {name}({params}) {{\n  const __disposers = [];\n  try {{\n{}    return {root};\n  }} catch (__e) {{\n    for (const __d of __disposers) __d();\n    throw __e;\n  }}\n}}\n",
            self.render("    ")
        )
    }

    // ── the component adopt body ──────────────────────────────────────────────────

    /// Emit the adopt branch of a component's `connectedCallback` (the inside of
    /// `if (isHydrating() && this.firstChild) { … }`, which csr splices in). The host's
    /// existing children *are* the server-rendered view, so this claims them off `cursor(this)`,
    /// wiring reactivity onto the adopted nodes. Mirrors csr's component plumbing —
    /// prop aliases/snapshots/rest, signal decls, effects, `$expose`, `onCleanup` — but
    /// with claims instead of `createElement`, and no `{children}` capture (the slotted
    /// children are already in place). `onMount` is shared (csr emits it after the
    /// switch). A view it can't walk pushes an error → caller falls back to rebuild.
    fn component_adopt(&mut self, lowered: &Lowered) -> String {
        // A component that takes `{children}` renders its slot inline on the server; the
        // children-region adoption (markers) is Phase 2.1. The `ViewNode::Children` in
        // its view would already error, but bail early with a clearer reason.
        if lowered.children_local.is_some() {
            self.errors
                .push("hydrate: components with a `{children}` slot are not adoptable yet (Phase 2.1)".into());
            return String::new();
        }
        self.emit_prop_aliases();
        self.emit_prop_snapshots();
        self.emit_rest();
        for item in lowered.body.clone() {
            self.emit_decl_item(&item);
        }

        let cur = self.fresh("__c");
        self.uses.cursor = true;
        self.line(format!("const {cur} = cursor(this);"));
        self.emit_node(&cur, &lowered.ir.view);

        // Effects + `$expose` + `onCleanup` (onMount is emitted by csr after the switch,
        // so it runs for both the build and adopt paths — don't duplicate it here).
        for cb in lowered.effects.clone() {
            self.bind(format!("effect({cb})"));
        }
        for obj in &lowered.exposes {
            self.line(format!("Object.assign(this, ({obj}));"));
        }
        if let Some(sink) = self.sink {
            for cb in &lowered.on_cleanups {
                self.line(format!("{sink}.push({cb});"));
            }
        }
        self.render("      ")
    }

    /// Alias prop signals so view references resolve (mirrors `csr::emit_prop_aliases`).
    fn emit_prop_aliases(&mut self) {
        if let Some(props_local) = self.lowered.props_object.clone() {
            if !self.lowered.props.is_empty() {
                self.line(format!("const {props_local} = this._props;"));
            }
            return;
        }
        for p in &self.lowered.props {
            self.line(format!("const {} = this._props[{}];", p.local, js_string(&p.attr)));
        }
    }

    /// One-time destructuring snapshots (mirrors `csr::emit_prop_snapshots`).
    fn emit_prop_snapshots(&mut self) {
        for s in &self.lowered.prop_snapshots {
            self.line(format!("const {} = ({}.value ?? {});", s.pattern, s.source, s.empty));
        }
    }

    /// `...rest` snapshot from the element's attributes (mirrors `csr::emit_rest`).
    fn emit_rest(&mut self) {
        if let Some(rest) = &self.lowered.rest {
            let excl = rest.exclude.iter().map(|k| js_string(k)).collect::<Vec<_>>().join(", ");
            self.line(format!("const {} = {{}};", rest.name));
            self.line(format!(
                "for (const __a of Array.from(this.attributes)) if (![{excl}].includes(__a.name)) {}[__a.name] = __a.value;",
                rest.name
            ));
        }
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

    // ── the adopt walk ────────────────────────────────────────────────────────────

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
            // A child component: claim its host element and wire any dynamic props onto
            // it, but do NOT recurse — the component self-adopts its own children when it
            // upgrades (its `connectedCallback` runs at `define`, before this walk), so
            // claiming the host advances the cursor past its whole subtree.
            ViewNode::Component { name, props, .. } => {
                if name.contains('.') {
                    self.errors.push(format!(
                        "hydrate: member-expression component <{name}> is not supported (SPEC §4.0.1)"
                    ));
                    return String::new();
                }
                let var = self.fresh("c");
                let tag_expr =
                    tags::use_tag_expr(name, &self.lowered.module_components, &format!("{name}Element"));
                self.uses.claim_element = true;
                self.line(format!("const {var} = claimElement({cur}, {tag_expr});"));
                for prop in props {
                    self.emit_component_prop(&var, prop);
                }
                var
            }
            // Static text: a real text node in the server HTML — step the cursor over it.
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
                // Collect the effect's disposer (like the CSR build path) so it is torn
                // down with the component and disposed on a mid-walk mismatch (issue 6).
                self.bind(format!("bindText({var}, () => ({}))", self.code(*expr)));
                var
            }
            // A keyed list region (`array.map`, docs/HYDRATION.md §3.1/2.1): the server
            // brackets it with `<!--[-->…<!--]-->`. Adopt each item's server node, seed the
            // reconcile cache, then wire the same keyed-reconcile effect CSR uses — so later
            // data changes build/move/remove with no first-paint flash.
            ViewNode::List { source, item_param, index_param, item, key } => {
                self.emit_list(cur, *source, item_param, index_param.as_deref(), item, *key);
                String::new()
            }
            // A conditional / dynamic-node region (`{cond ? <A/> : <B/>}`, `{cond && <X/>}`):
            // the server brackets the rendered branch with `<!--[-->…<!--]-->`. Adopt that
            // branch's nodes off the shared cursor, then wire `hydrateChild` to swap to a
            // freshly-built branch when a later reactive change selects a different one.
            ViewNode::DynamicNode { expr, branches } => {
                self.emit_dynamic_node(cur, *expr, branches);
                String::new()
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

    /// Adopt a keyed list region off the shared cursor `cur` (positioned at the opening
    /// `<!--[-->` marker). Emits two item functions into the current scope — an **adopt**
    /// walk (`{base}_hitem{n}`, claims one server item off the cursor) and a CSR **build**
    /// (`{base}_item{n}`, for items that appear after first paint) — then a `hydrateList`
    /// call that seeds the reconcile cache from the adopted nodes and wires the ongoing
    /// keyed-reconcile effect (its disposer collected like any other binding).
    fn emit_list(
        &mut self,
        cur: &str,
        source: ExpressionId,
        item_param: &str,
        index_param: Option<&str>,
        item: &ViewNode,
        key: Option<ExpressionId>,
    ) {
        let n = self.list_counter;
        self.list_counter += 1;
        let adopt_fn = format!("{}_hitem{}", self.base, n);
        let build_fn = format!("{}_item{}", self.base, n);

        // The adopt-item walk (claims one server item subtree off the shared cursor).
        self.emit_adopt_item_fn(&adopt_fn, item, item_param, index_param);
        // The CSR build for items reconciled in *after* first paint — the same subtree the
        // component/page's own CSR arm builds, so no new helper imports are introduced.
        for l in emit_build_item_fn(self.lowered, &build_fn, item, item_param, index_param) {
            self.line(l);
        }

        let source_code = self.code(source);
        let key_fn = match key {
            Some(k) => format!("({item_param}, _index) => ({})", self.code(k)),
            None => "undefined".to_string(),
        };
        self.uses.hydrate_list = true;
        self.bind(format!(
            "hydrateList({cur}, () => ({source_code}), {adopt_fn}, {build_fn}, {key_fn})"
        ));
    }

    /// Emit a local `function {fn_name}(__ic, {item_param}, {index}) { …; return root; }`
    /// that *adopts* one list item's server subtree off the cursor `__ic` (the shared list
    /// cursor — claiming the item root advances it to the next item). Closes over the
    /// component/page signals (emitted inline in the factory scope). Inner item effects are
    /// not collected — they live and die with the item node (mirrors csr's `build_fn`).
    fn emit_adopt_item_fn(
        &mut self,
        fn_name: &str,
        item: &ViewNode,
        item_param: &str,
        index_param: Option<&str>,
    ) {
        let saved_lines = std::mem::take(&mut self.lines);
        let saved_counter = self.counter;
        let saved_sink = self.sink;
        self.counter = 0;
        self.sink = None;

        let root = self.emit_node("__ic", item);

        let body = std::mem::replace(&mut self.lines, saved_lines);
        self.counter = saved_counter;
        self.sink = saved_sink;

        let index = index_param.unwrap_or("_index");
        self.line(format!("function {fn_name}(__ic, {item_param}, {index}) {{"));
        for l in &body {
            self.line(format!("  {l}"));
        }
        self.line(format!("  return {root};"));
        self.line("}".to_string());
    }

    /// Adopt a conditional / dynamic-node region off the shared cursor `cur` (at the opening
    /// `<!--[-->` marker). For each embedded JSX branch, emits an **adopt** fn (claims that
    /// branch's server nodes off the cursor) and a CSR **build** fn (for when a later change
    /// selects it). Two closures over the same branch expression — one substituting the adopt
    /// calls, one the build calls — are handed to `hydrateChild`: it runs the adopt closure to
    /// claim the rendered branch, then swaps via the build closure on change (the disposer is
    /// collected like any other binding).
    fn emit_dynamic_node(&mut self, cur: &str, expr: ExpressionId, branches: &[ViewNode]) {
        let mut adopt_calls = Vec::with_capacity(branches.len());
        let mut build_calls = Vec::with_capacity(branches.len());
        for branch in branches {
            let n = self.list_counter;
            self.list_counter += 1;
            let adopt_fn = format!("{}_hnode{}", self.base, n);
            let build_fn = format!("{}_node{}", self.base, n);
            self.emit_adopt_node_fn(&adopt_fn, branch);
            for l in emit_build_node_fn(self.lowered, &build_fn, branch) {
                self.line(l);
            }
            // The adopt fn claims off the shared region cursor `__ic`; the build fn takes none.
            adopt_calls.push(format!("{adopt_fn}(__ic)"));
            build_calls.push(format!("{build_fn}()"));
        }

        let template = self.code(expr);
        let adopt_expr = substitute_branches_pub(&template, &adopt_calls);
        let build_expr = substitute_branches_pub(&template, &build_calls);
        self.uses.hydrate_child = true;
        self.bind(format!(
            "hydrateChild({cur}, (__ic) => ({adopt_expr}), () => ({build_expr}))"
        ));
    }

    /// Emit a local `function {fn_name}(__ic) { …; return root; }` that *adopts* one
    /// conditional branch's server subtree off the cursor `__ic` (the shared region cursor).
    /// Only the branch the server rendered is claimed — the others' fns are never called
    /// (the branch expression short-circuits). Closes over the component/page signals.
    fn emit_adopt_node_fn(&mut self, fn_name: &str, branch: &ViewNode) {
        let saved_lines = std::mem::take(&mut self.lines);
        let saved_counter = self.counter;
        let saved_sink = self.sink;
        self.counter = 0;
        self.sink = None;

        let root = self.emit_node("__ic", branch);

        let body = std::mem::replace(&mut self.lines, saved_lines);
        self.counter = saved_counter;
        self.sink = saved_sink;

        self.line(format!("function {fn_name}(__ic) {{"));
        for l in &body {
            self.line(format!("  {l}"));
        }
        self.line(format!("  return {root};"));
        self.line("}".to_string());
    }

    /// Wire a prop onto an already-claimed **host element**. Static attributes are in
    /// the server HTML, so they are skipped; only dynamic attributes, events, and `ref`
    /// produce code.
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
            PropValue::Static(_) => {} // already serialized into the server HTML
            PropValue::Dynamic(expr) => {
                let code = self.code(*expr);
                if is_listener(&prop.name) {
                    self.emit_listener(el, &prop.name, &code);
                } else if is_event(&prop.name) {
                    self.line(format!("{el}.{} = {code};", prop.name.to_ascii_lowercase()));
                } else {
                    // Collect the disposer (like CSR) for teardown + mismatch cleanup.
                    self.bind(format!("bindAttr({el}, {}, () => ({code}))", js_string(&prop.name)));
                }
            }
            PropValue::DynamicNode { .. } => {
                self.errors
                    .push("hydrate: JSX-valued props are not supported yet (Phase 2.1)".into());
            }
        }
    }

    /// Wire a prop onto an already-claimed **child-component host**. Static props are in
    /// the server attributes (skipped); dynamic data goes through `setProp` (reactive),
    /// `on*` is a callback property, `on*:mod` an event listener (mirrors
    /// `csr::emit_component_prop`, dynamic-only).
    fn emit_component_prop(&mut self, el: &str, prop: &Prop) {
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
            // A static prop is carried by the serialized island payload and read by the
            // upgrading component's constructor (rich value, no flash) — nothing to
            // re-apply during adoption. (`ssgComponent` reflects nothing onto the host tag;
            // the payload, not host attributes, is how declared props cross to the client.)
            PropValue::Static(_) => {}
            PropValue::Dynamic(expr) => {
                let code = self.code(*expr);
                if is_listener(&prop.name) {
                    self.emit_listener(el, &prop.name, &code);
                } else if is_event(&prop.name) {
                    self.line(format!("{el}[{}] = {code};", js_string(&prop.name)));
                } else {
                    self.bind(format!("effect(() => {{ setProp({el}, {}, ({code})); }})", js_string(&prop.name)));
                }
            }
            PropValue::DynamicNode { .. } => {
                self.errors
                    .push("hydrate: JSX-valued props are not supported yet (Phase 2.1)".into());
            }
        }
    }

    /// `on*:mod={fn}` → `addEventListener`, collecting a remove-disposer in a component
    /// (mirrors `csr::emit_event_listener`). In a page the node is discarded on nav, so
    /// the listener is inlined with no teardown.
    fn emit_listener(&mut self, el: &str, prop_name: &str, code: &str) {
        let (event, opts) = event_options(prop_name);
        let name = js_string(&event);
        match self.sink {
            None => self.line(format!("{el}.addEventListener({name}, {code}{opts});")),
            Some(sink) => {
                let h = self.fresh("__ev");
                self.line(format!("const {h} = {code};"));
                self.line(format!("{el}.addEventListener({name}, {h}{opts});"));
                self.line(format!("{sink}.push(() => {el}.removeEventListener({name}, {h}{opts}));"));
            }
        }
    }
}

fn node_kind(node: &ViewNode) -> &'static str {
    // Lists and conditionals now have their own adopt arms (Phase 2.1); only these remain.
    match node {
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

    /// Lower in **component** mode (the default export becomes a Custom Element class,
    /// not a page factory) — for exercising component adoption.
    fn emit_component(source: &str) -> HydrateModule {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("/app/Counter.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
        let m = lower_module("/app/Counter.tsx", &parsed.program, source, false).expect("lowered");
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
        assert!(m.code.contains("export default function ()"), "csr factory:\n{}", m.code);
        assert!(m.code.contains("document.createElement(\"div\")"), "csr builds:\n{}", m.code);
        assert!(
            m.code.contains("import { cursor, claimElement, claimText, skipNode } from \"@opentf/web\";"),
            "claim import:\n{}",
            m.code
        );

        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("export function hydrate(__root)"), "hydrate shape:\n{}", hyd);
        assert!(hyd.contains("const __c0 = cursor(__root);"), "root cursor:\n{}", hyd);
        assert!(hyd.contains("const el1 = claimElement(__c0, \"div\");"), "claim div:\n{}", hyd);
        assert!(hyd.contains("claimElement(__c2, \"h1\");"), "claim h1:\n{}", hyd);
        assert!(hyd.contains("skipNode(__c4);"), "skip static text:\n{}", hyd);
        assert!(hyd.contains("const t5 = claimText(__c4);"), "claim text hole:\n{}", hyd);
        // The effect disposer is collected so a mid-walk mismatch can dispose it (issue 6).
        assert!(hyd.contains("__disposers.push(bindText(t5, () => (n.value)));"), "wire text:\n{}", hyd);
        assert!(hyd.contains("const __disposers = [];"), "disposer sink:\n{}", hyd);
        assert!(hyd.contains("for (const __d of __disposers) __d();"), "mismatch cleanup:\n{}", hyd);
        assert!(!hyd.contains("createElement"), "adopt creates no nodes:\n{}", hyd);
        assert!(!hyd.contains("appendChild"), "adopt appends nothing:\n{}", hyd);
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
        let m = emit("export default function P(){ return <div onscroll:passive={() => {}}>x</div>; }");
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        // The page factory sinks disposers into `__disposers` (for mismatch cleanup), so
        // the listener is bound to a captured handler and a remover is collected.
        assert!(hyd.contains("const __ev2 = () => {};"), "captured handler:\n{}", hyd);
        assert!(hyd.contains("el1.addEventListener(\"scroll\", __ev2, { passive: true });"), "listener:\n{}", hyd);
        assert!(
            hyd.contains("__disposers.push(() => el1.removeEventListener(\"scroll\", __ev2, { passive: true }));"),
            "remover collected:\n{}",
            hyd
        );
    }

    #[test]
    fn component_emits_a_dual_class_that_adopts_when_server_rendered() {
        // A standalone interactive component (the canonical island): the csr class is
        // emitted, but its connectedCallback branches on `this.firstChild`.
        let m = emit_component(
            "export default function Counter(){ let n=$state(0); return <button onclick={() => n++}>Count {n}</button>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // The dual switch: adopt only during the first-paint hydration pass (the flag, not
        // `this.firstChild` alone — a client-created host with call-site children also has
        // one), build otherwise. The CSR build is shared via a `__build` closure.
        assert!(m.code.contains("if (isHydrating() && this.firstChild) {"), "dual switch:\n{}", m.code);
        assert!(m.code.contains("const __build = () => {"), "shared build closure:\n{}", m.code);
        assert!(m.code.contains("const __c0 = cursor(this);"), "adopt over this:\n{}", m.code);
        assert!(m.code.contains("claimElement(__c0, \"button\");"), "claim host child:\n{}", m.code);
        assert!(m.code.contains("} else {\n      __build();"), "build arm runs the closure:\n{}", m.code);
        assert!(m.code.contains("document.createElement(\"button\")"), "build arm builds:\n{}", m.code);
        // Per-component mismatch recovery (docs/HYDRATION.md §3.5): report + rebuild via CSR.
        assert!(m.code.contains("if (!(__e instanceof HydrationMismatch)) throw __e;"), "mismatch guard:\n{}", m.code);
        assert!(
            m.code.contains("reportError(__e, { phase: \"hydrate\", component: \"Counter\" });"),
            "mismatch reported:\n{}",
            m.code
        );
        assert!(
            m.code.contains("import { signal, bindText, handleError, isHydrating, HydrationMismatch, reportError }"),
            "hydration helpers imported:\n{}",
            m.code
        );
        // No standalone `hydrate` export — a component hydrates via its class, not a factory.
        assert!(!m.code.contains("export function hydrate"), "no page factory:\n{}", m.code);
    }

    #[test]
    fn page_using_a_component_claims_the_host_without_recursing() {
        // The page adopt walk claims the <web-counter> host by its `.tag` and moves on —
        // the component self-adopts its own subtree.
        let m = emit(
            "import Counter from \"./Counter\"; export default function P(){ return <div><Counter/></div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("export function hydrate(__root)"), "page hydrate factory:\n{}", hyd);
        assert!(hyd.contains("claimElement(__c0, \"div\");"), "claim wrapper:\n{}", hyd);
        assert!(hyd.contains("claimElement(__c2, Counter.tag);"), "claim component host by tag:\n{}", hyd);
    }

    #[test]
    fn component_with_children_slot_falls_back_to_rebuild() {
        // A component that takes `{children}` can't adopt yet → csr emits a build-only
        // class. On client navigation it must capture the call-site children *before*
        // clearing; only the first-paint hydration pass (server DOM is the rendered view,
        // not the slot children) discards them. So the clear is gated on `isHydrating()`.
        let m = emit_component(
            "export default function Card({ children }){ return <div class=\"card\">{children}</div>; }",
        );
        assert!(
            m.code.contains("if (isHydrating() && this.firstChild) this.replaceChildren();"),
            "server-DOM discard gated on the hydration flag:\n{}",
            m.code
        );
        // The unconditional clear (which would lose call-site children on nav) must be gone.
        assert!(
            !m.code.contains("try {\n    if (this.firstChild) this.replaceChildren();"),
            "no unconditional pre-capture clear:\n{}",
            m.code
        );
        assert!(m.code.contains("const children = Array.from(this.childNodes);"), "capture:\n{}", m.code);
        assert!(!m.code.contains("const __c0 = cursor(this);"), "no adopt walk:\n{}", m.code);
        assert!(m.errors.iter().any(|e| e.contains("children")), "warning: {:?}", m.errors);
    }

    #[test]
    fn page_adopt_walk_does_not_re_apply_static_component_props() {
        // Static component props cross to the client through the serialized island payload
        // (read by the component's own constructor), not by the page re-applying them — so
        // the page's adopt walk claims the host and wires nothing for a static prop
        // (avoiding the adopt-then-`setProp` flash the earlier fix had).
        let m = emit(
            "import Badge from \"./Badge\"; export default function P(){ return <div><Badge label=\"hi\"/></div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("claimElement(__c2, Badge.tag);"), "claim host:\n{}", hyd);
        assert!(!hyd.contains("setProp(c3"), "no static-prop re-application in adopt:\n{}", hyd);
    }

    #[test]
    fn hydratable_component_constructor_reads_the_serialized_payload() {
        // A hydrate-target component initializes its prop signals from the rich payload
        // (keyed by the host's `data-h` id), falling back to the attribute/default.
        let m = emit_component(
            "export default function Badge({ label }){ return <span class=\"badge\">{label}</span>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("const __h = hydrationProps(this);"), "reads payload:\n{}", m.code);
        assert!(
            m.code.contains("label: signal(__h && \"label\" in __h ? __h[\"label\"] : (this.getAttribute(\"label\"))),"),
            "prop init prefers payload, falls back to attribute:\n{}",
            m.code
        );
        assert!(
            m.code.lines().any(|l| l.contains("from \"@opentf/web\"") && l.contains("hydrationProps")),
            "hydrationProps imported:\n{}",
            m.code
        );
    }

    #[test]
    fn list_page_adopts_the_region_with_a_seeded_reconcile() {
        // A keyed list region hydrates (Phase 2.1): the page gets a `hydrate` factory that
        // claims each item off the shared cursor via an adopt-item fn, keeps a CSR build-item
        // fn for items added after first paint, and seeds `hydrateList` with both.
        let m = emit("export default function P(){ return <ul>{[1,2,3].map(x => <li>{x}</li>)}</ul>; }");
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("export function hydrate(__root)"), "page hydrate factory:\n{}", hyd);
        // Adopt-item fn: claims the <li> and its text hole off the shared cursor `__ic`.
        assert!(hyd.contains("function default_hitem0(__ic, x, _index) {"), "adopt-item fn:\n{}", hyd);
        assert!(hyd.contains("const el0 = claimElement(__ic, \"li\");"), "adopt claims item root:\n{}", hyd);
        assert!(hyd.contains("bindText(t2, () => (x.value));"), "adopt wires the item text hole:\n{}", hyd);
        // Build-item fn: a real CSR builder (for items reconciled in after first paint).
        assert!(hyd.contains("function default_item0(x, _index) {"), "build-item fn:\n{}", hyd);
        assert!(hyd.contains("document.createElement(\"li\")"), "build-item builds:\n{}", hyd);
        // The reconcile is seeded with both, over the list's shared cursor.
        assert!(
            hyd.contains("hydrateList(__c2, () => ([1,2,3]), default_hitem0, default_item0, undefined)"),
            "hydrateList call:\n{}",
            hyd
        );
        assert!(
            m.code.contains("import { cursor, claimElement, claimText, hydrateList }"),
            "import:\n{}",
            m.code
        );
    }

    #[test]
    fn conditional_region_adopts_the_rendered_branch_and_swaps_on_change() {
        // A `{cond ? <A/> : <B/>}` region hydrates (Phase 2.1b): the page gets a `hydrate`
        // factory with an adopt fn + a CSR build fn per branch, and `hydrateChild` claims the
        // rendered branch (adopt closure), swapping to a freshly-built branch on change.
        let m = emit(
            "export default function P(){ let open=$state(true); return <div>{open ? <p>yes</p> : <span>no</span>}</div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        // Adopt fns claim each branch off the shared region cursor `__ic` (only the taken one runs).
        assert!(hyd.contains("function default_hnode0(__ic) {"), "adopt fn branch 0:\n{}", hyd);
        assert!(hyd.contains("claimElement(__ic, \"p\");"), "adopt claims <p>:\n{}", hyd);
        assert!(hyd.contains("function default_hnode1(__ic) {"), "adopt fn branch 1:\n{}", hyd);
        assert!(hyd.contains("claimElement(__ic, \"span\");"), "adopt claims <span>:\n{}", hyd);
        // CSR build fns for the branch selected after first paint.
        assert!(hyd.contains("function default_node0() {"), "build fn branch 0:\n{}", hyd);
        assert!(hyd.contains("document.createElement(\"p\")"), "build fn builds <p>:\n{}", hyd);
        // hydrateChild gets the adopt closure (claims) and the build closure (swaps), both over
        // the same branch expression.
        assert!(
            hyd.contains("hydrateChild(__c2, (__ic) => (open.value ? default_hnode0(__ic) : default_hnode1(__ic)), () => (open.value ? default_node0() : default_node1()))"),
            "hydrateChild call:\n{}",
            hyd
        );
        assert!(m.code.contains("hydrateChild"), "hydrateChild imported:\n{}", m.code);
    }

    #[test]
    fn keyed_list_threads_its_key_fn_through() {
        let m = emit(
            "export default function P(){ return <ul>{[1,2].map(x => <li key={x}>{x}</li>)}</ul>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("(x, _index) => (x)"), "key fn threaded to hydrateList:\n{}", hyd);
    }
}
