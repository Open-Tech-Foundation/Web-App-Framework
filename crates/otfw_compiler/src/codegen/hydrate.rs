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
//! build fn swaps it on change) — Phase 2.1. A page/layout `{children}` slot adopts via the
//! router-threaded children thunk (`hydrateAt(cursor, props)` + a `hydrate(root, props)`
//! wrapper, so one cursor threads the whole layout chain — Phase 2.1c). A *component's*
//! light-DOM `{children}` slot adopts too (Phase 2.1d): the component steps over its slot
//! (`skipSlot`) while the composing parent locates the slot and adopts the slotted content's
//! reactivity (`hydrateSlot`), since that content is the parent's JSX. A **fragment /
//! multi-node root** adopts each top-level node in sequence off the shared cursor — pages via
//! a `DocumentFragment` lifecycle carrier (`fn page`), components via `emit_root_view`. A
//! **JSX-value local** (`const body = <div/>`, Phase 2.1e) is emitted as a dual
//! `{ build, adopt }` object; a `{body}` hole adopts the server subtree in place
//! (`hydrateHole`) and a bare-identifier dynamic-node branch adopts off the region cursor,
//! instead of the claimText strip-and-rebuild that would flash and cascade rebuilds through
//! nested islands. A view this backend still can't adopt (an unsupported node *kind*, or a
//! JSX value in a non-positional shape like `const map = { a: <A/> }`) falls back: pages get
//! no `hydrate` export (the router rebuilds via CSR); components get
//! `ComponentView::RebuildIfServerChildren`.

use otfw_ir::reactivity::SignalKind;
use otfw_ir::view::{Prop, PropValue, ViewNode};
use otfw_ir::ExpressionId;

use crate::codegen::csr::{
    self, emit_build_item_fn, emit_build_node_fn, event_options, is_event, is_listener, js_string,
    substitute_branches_pub, ComponentView, Template,
};
use crate::codegen::static_tree;
use crate::codegen::tags;
use crate::lower::{BodyItem, ExprTable, Lowered, SignalDecl};

/// How a reference to a JSX-value local is rewritten in a dynamic-node branch template:
/// claim it off the region cursor, rebuild it, or drop it (the deps-only template).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Subst {
    Adopt,
    Build,
    Deps,
}

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
    claim_region: bool,
    skip_slot: bool,
    hydrate_slot: bool,
    hydrate_hole: bool,
}

fn merge_uses(into: &mut Uses, from: &Uses) {
    into.cursor |= from.cursor;
    into.claim_element |= from.claim_element;
    into.claim_text |= from.claim_text;
    into.skip_node |= from.skip_node;
    into.hydrate_list |= from.hydrate_list;
    into.hydrate_child |= from.hydrate_child;
    into.claim_region |= from.claim_region;
    into.skip_slot |= from.skip_slot;
    into.hydrate_slot |= from.hydrate_slot;
    into.hydrate_hole |= from.hydrate_hole;
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
    // Static subtrees stamped from a hoisted `<template>` by the CSR build functions
    // embedded in the adopt bodies and page factories below. They are handed to the CSR
    // module emitter so the declarations land at module scope, ahead of every `define`.
    let mut templates: Vec<Template> = Vec::new();
    for c in components {
        if c.is_page {
            adopt_bodies.push(None);
            continue;
        }
        let mut e = Emitter::new(c, Some("this._cleanups"));
        let body = e.component_adopt(c);
        if e.errors.is_empty() {
            merge_uses(&mut uses, &e.uses);
            templates.extend(e.templates);
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

    // 2. A `hydrate` adopt factory for every page we can adopt. Built *before* the CSR
    // module even though it is appended after it: the CSR call is what hoists the
    // module's template declarations, and these factories stamp from them too.
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
            templates.extend(e.templates);
            page_bodies.push(body);
        } else {
            errors.extend(e.errors);
        }
    }

    let base =
        csr::emit_module_with_adopt(components, module_stmts, module_exprs, &views, &templates);
    let mut code = base.code;
    errors.extend(base.errors);

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
    if uses.claim_region {
        names.push("claimRegionStart");
        names.push("claimRegionEnd");
    }
    if uses.skip_slot {
        names.push("skipSlot");
    }
    if uses.hydrate_slot {
        names.push("hydrateSlot");
    }
    if uses.hydrate_hole {
        names.push("hydrateHole");
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
    /// Names of **JSX-value locals** in scope (`const body = <div/>` — Phase 2.1e). Each is
    /// emitted as a dual `{ build, adopt }` object (see [`Self::emit_jsx_value_local`]); its
    /// name is recorded here so a view reference to it — a `{body}` hole or a bare identifier
    /// in a dynamic-node branch — adopts the server subtree in place instead of rebuilding it.
    value_locals: Vec<String>,
    /// Static subtrees the CSR build functions spliced in here stamp from a hoisted
    /// `<template>`. They are handed to `csr::emit_module_with_adopt` so the `const`
    /// lands at module scope ahead of every `customElements.define`.
    templates: Vec<Template>,
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
            value_locals: Vec::new(),
            templates: Vec::new(),
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

    /// Emit a page/layout as a hydrate factory pair (docs/HYDRATION.md §3.4, 2.1c):
    ///
    /// - `hydrateAt(__c, props)` — the adopt walk over an *existing* cursor `__c`. A layout
    ///   hands its own cursor to the nested content at its `{children}` slot (`props.children`
    ///   is a thunk that adopts the inner route and advances the cursor), so one cursor threads
    ///   the whole layout chain.
    /// - `hydrate(__root, props)` — the top-level entry the router calls on the container:
    ///   `hydrateAt(cursor(__root), props)`. Kept as the adoptability marker + leaf convenience.
    ///
    /// Both return the claimed root node.
    fn page(&mut self, lowered: &Lowered) -> String {
        if !lowered.props.is_empty() {
            self.errors.push("hydrate: page/factory props not supported yet".into());
        }
        for item in lowered.body.clone() {
            self.emit_decl_item(&item);
        }

        // Adopt the view from the passed-in cursor (over the container's — or the enclosing
        // layout slot's — children). The cursor is `hydrateAt`'s first parameter, so nested
        // routes adopt inline at the layout's slot without a fresh `cursor(root)`.
        //
        // A multi-node (fragment) page root — the common shape of an MDX document, whose
        // top-level blocks (`<h1>`, `<p>`, `<h2>`…) are consecutive siblings with no wrapping
        // element — adopts each child in sequence off the shared cursor, exactly as a
        // component's `emit_root_view` does. There is no single root element to return or hang
        // lifecycle on, so a `DocumentFragment` stands in as the carrier the router runs
        // onMount/onCleanup against; it stays empty (the adopted nodes are already live in the
        // server DOM and are never moved into it), mirroring the CSR page's fragment root after
        // it has been appended. Without this, MDX pages emitted no `hydrateAt` and every one
        // fell back to a full CSR rebuild on first paint — a visible content flash.
        let cur = self.fresh("__c");
        let root = if let ViewNode::Fragment(_) = &lowered.ir.view {
            self.emit_root_view(&cur, &lowered.ir.view);
            let frag = self.fresh("frag");
            self.line(format!("const {frag} = document.createDocumentFragment();"));
            frag
        } else {
            self.emit_node(&cur, &lowered.ir.view)
        };

        // Top-level $effect callbacks run for the page's lifetime (page disposal: none).
        // Embedded JSX substitutes as inline CSR builders (effects build fresh nodes).
        for cb in lowered.effects.clone() {
            let (code, tmpls) = csr::effect_code_pub(lowered, &cb);
            self.templates.extend(tmpls);
            self.bind(format!("effect({code})"));
        }

        // Lifecycle: attach an `__lifecycle` record to the root so the router runs
        // onMount after adoption and onCleanup teardown on navigation (mirrors CSR).
        // The DOM hooks (`onResize`/`onVisibilityChange`/`onMediaQuery`) desugar to
        // mount closures returning their disposer, riding the same record. A
        // non-element root can't host the observer hooks — skip them like the CSR
        // factory does, but do NOT push the error here: the dual module's csr part
        // already reports it, and an error in this emitter would drop the page's
        // hydrate factory entirely (falling back to a CSR rebuild) over a warning.
        let (dom_hooks, tmpls) =
            csr::dom_hook_closures_pub(lowered, &root, csr::dom_hook_root_error(lowered).is_none());
        self.templates.extend(tmpls);
        if !lowered.on_mounts.is_empty() || !lowered.on_cleanups.is_empty() || !dom_hooks.is_empty()
        {
            self.line("const __lifecycle = { mounts: [], cleanups: [] };".into());
            for cb in &lowered.on_cleanups {
                let (code, tmpls) = csr::effect_code_pub(lowered, cb);
                self.templates.extend(tmpls);
                self.line(format!("__lifecycle.cleanups.push({code});"));
            }
            for cb in &lowered.on_mounts {
                let (code, tmpls) = csr::effect_code_pub(lowered, cb);
                self.templates.extend(tmpls);
                self.line(format!("__lifecycle.mounts.push({code});"));
            }
            for closure in dom_hooks {
                self.line(format!("__lifecycle.mounts.push({closure});"));
            }
            self.line(format!("{root}.__lifecycle = __lifecycle;"));
        }

        let param = lowered.page_param.as_deref().unwrap_or("");
        let export = &lowered.ir.id.export;
        let (at_name, name) = if export == "default" {
            ("hydrateAt".to_string(), "hydrate".to_string())
        } else {
            (format!("hydrateAt_{export}"), format!("hydrate_{export}"))
        };
        let at_params =
            if param.is_empty() { cur.clone() } else { format!("{cur}, {param}") };
        let (wrap_params, wrap_args) = if param.is_empty() {
            ("__root".to_string(), format!("cursor(__root)"))
        } else {
            (format!("__root, {param}"), format!("cursor(__root), {param}"))
        };
        self.uses.cursor = true; // the `hydrate` wrapper's `cursor(__root)`
        // Dispose the effects wired so far if the adopt walk throws a `HydrationMismatch`
        // partway (issue 6): the router catches the throw and rebuilds via CSR, so without
        // this the partial page's `bindText`/`bindAttr`/`effect` subscriptions would leak
        // and double up against the rebuild.
        format!(
            "export function {at_name}({at_params}) {{\n  const __disposers = [];\n  try {{\n{}    return {root};\n  }} catch (__e) {{\n    for (const __d of __disposers) __d();\n    throw __e;\n  }}\n}}\nexport function {name}({wrap_params}) {{\n  return {at_name}({wrap_args});\n}}\n",
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
    /// children are already in place — the component steps over its `{children}` slot via
    /// `skipSlot`, and the *parent* adopts the slotted content's reactivity, §2.1d). `onMount`
    /// is shared (csr emits it after the switch). A view it can't walk pushes an error →
    /// caller falls back to rebuild.
    fn component_adopt(&mut self, lowered: &Lowered) -> String {
        self.emit_prop_aliases();
        self.emit_prop_snapshots();
        self.emit_rest();
        // Adoption doesn't *capture* light-DOM children (they are already server-rendered in
        // place), but the children local must still exist in this scope: a JSX-value local's
        // CSR `build` fallback is emitted here and closes over it, so a reactive rebuild after
        // first paint would otherwise hit `ReferenceError: <local> is not defined`. Declare it
        // up front (before the body decls that emit those build fns) and let the walk's
        // `skipSlot` fill it with the real slotted nodes.
        if let Some(local) = lowered.children_local.clone() {
            self.line(format!("let {local} = [];"));
        }
        for item in lowered.body.clone() {
            self.emit_decl_item(&item);
        }

        let cur = self.fresh("__c");
        self.uses.cursor = true;
        self.line(format!("const {cur} = cursor(this);"));
        self.emit_root_view(&cur, &lowered.ir.view);

        // Effects + `$expose` + `onCleanup`. `onMount` is emitted by csr *inside* this
        // adopt branch (and inside `__build`) — not here — because its callbacks close over
        // the component's locals, which live in each path's own scope.
        for cb in lowered.effects.clone() {
            let (code, tmpls) = csr::effect_code_pub(lowered, &cb);
            self.templates.extend(tmpls);
            self.bind(format!("effect({code})"));
        }
        for obj in &lowered.exposes {
            let (code, tmpls) = csr::effect_code_pub(lowered, obj);
            self.templates.extend(tmpls);
            self.line(format!("Object.assign(this, ({code}));"));
        }
        if let Some(sink) = self.sink {
            for cb in &lowered.on_cleanups {
                let (code, tmpls) = csr::effect_code_pub(lowered, cb);
                self.templates.extend(tmpls);
                self.line(format!("{sink}.push({code});"));
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
            BodyItem::Jsx { template, nodes } => {
                // A JSX-value local whose right-hand side puts every JSX node in a *node
                // position* — `const body = <div/>`, or the layout idiom
                // `const body = cond ? <a/> : <b/>` / `cond && <a/>` — is adoptable: emit it as
                // a dual `{ adopt, build }` object and record the name so its view uses claim
                // the server subtree. The server rendered whichever branch the condition chose,
                // and the condition is deterministic across server and client (the same
                // hydration assumption everything else rests on), so evaluating the adopt
                // template picks the same one. Any other JSX-embedding statement
                // (`const map = { a: <A/> }`) isn't positional — keep the safe rebuild fallback.
                match value_local(template) {
                    Some((name, rhs)) => self.emit_jsx_value_local(&name, &rhs, nodes),
                    None => self
                        .errors
                        .push("hydrate: JSX-as-value is not supported yet (Phase 2.1)".into()),
                }
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

    /// Emit a **JSX-value local** (`const body = <div/>`, Phase 2.1e) as a dual
    /// `{ build, adopt }` object, recording its name in `value_locals`.
    ///
    /// - `adopt(__vc)` claims the value's server subtree off a passed-in cursor. A `{body}`
    ///   hole hands it the cursor inside the hole's `<!--$-->…<!--/-->` markers (via
    ///   `hydrateHole`); a bare-identifier dynamic-node branch (`cond ? <a/> : body`) hands it
    ///   the region cursor. Bindings inside the adopted subtree collect into the enclosing sink
    ///   as usual — the closure runs within the factory's adopt walk and disposal scope.
    /// - `build()` is the CSR builder the dynamic-node swap machinery falls back to when a
    ///   reactive change selects this branch after first paint. A JSX-value local is a `const`,
    ///   so a `{body}` hole never swaps (there is no build call there); but a branch position
    ///   whose *condition* is reactive still needs a builder for the not-server-rendered case.
    ///
    /// `build()` used to need a memo guarding one *spurious* call, because `hydrateChild` ran
    /// the build template on its first effect run just to subscribe to the branch expression's
    /// deps — which re-slotted the component's `{children}` and `appendChild`-moved those live
    /// server nodes into the discarded tree. `hydrateChild` now takes a separate deps closure
    /// (branches → `null`), so the spurious call is gone and `build()` only ever runs for a
    /// genuine swap.
    /// `rhs` is the right-hand side with each JSX node replaced by its `\u{0}i\u{0}`
    /// placeholder — a lone placeholder for the bare shape, or a conditional whose branches are
    /// placeholders. Each node gets a CSR build fn and an adopt fn, and the two templates are
    /// the `rhs` with those calls substituted in, so a conditional evaluates its condition once
    /// and adopts (or builds) only the branch it selects.
    fn emit_jsx_value_local(&mut self, name: &str, rhs: &str, nodes: &[ViewNode]) {
        let mut build_calls = Vec::with_capacity(nodes.len());
        let mut adopt_calls = Vec::with_capacity(nodes.len());
        for node in nodes {
            let n = self.list_counter;
            self.list_counter += 1;
            let build_fn = format!("{}_vbuild{}", self.base, n);
            let adopt_fn = format!("{}_vadopt{}", self.base, n);
            let (build_lines, tmpls) = csr::emit_build_node_fn(self.lowered, &build_fn, node);
            self.templates.extend(tmpls);
            for l in build_lines {
                self.line(l);
            }
            self.emit_value_adopt_fn(&adopt_fn, node);
            build_calls.push(format!("{build_fn}()"));
            adopt_calls.push(format!("{adopt_fn}(__vc)"));
        }
        let build_expr = substitute_branches_pub(rhs, &build_calls);
        let adopt_expr = substitute_branches_pub(rhs, &adopt_calls);
        self.line(format!("const {name} = {{"));
        self.line(format!("  build: () => ({build_expr}),"));
        self.line(format!("  adopt: (__vc) => ({adopt_expr}),"));
        self.line("};".into());
        self.value_locals.push(name.to_string());
    }

    /// Emit `const {fn_name} = (__vc) => { …; return root; };` — the adopt walk for one JSX
    /// node of a value local, claiming off the cursor it is handed.
    ///
    /// An **arrow const**, not a hoisted `function`: the walk's bindings collect into the
    /// enclosing sink (`this._cleanups` in a component), so the body must keep the outer
    /// `this`. It also has to be *declared before use* rather than hoisted — which it is, since
    /// the local's `{ build, adopt }` object is emitted right after.
    fn emit_value_adopt_fn(&mut self, fn_name: &str, node: &ViewNode) {
        // Emit into a nested buffer so it can be wrapped in the arrow. Reset the name counter
        // so the closure's own locals (`el0`, `__c1`, …) are scoped to it; restore after so
        // the outer walk's numbering is unaffected.
        let saved_lines = std::mem::take(&mut self.lines);
        let saved_counter = self.counter;
        self.counter = 0;
        let root = self.emit_node("__vc", node);
        let body = std::mem::replace(&mut self.lines, saved_lines);
        self.counter = saved_counter;

        self.line(format!("const {fn_name} = (__vc) => {{"));
        for l in &body {
            self.line(format!("  {l}"));
        }
        self.line(format!("  return {root};"));
        self.line("};".to_string());
    }

    /// Substitute references to JSX-value locals in a dynamic-node branch expression: an
    /// adopt template turns `body` into `body.adopt(__ic)` (claim off the region cursor), a
    /// build template into `body.build()`, and the deps template into `null` (evaluate the
    /// condition, construct nothing — see [`Self::emit_dynamic_node`]). Only whole-identifier
    /// tokens are replaced (never a member access like `foo.body`), so an ordinary property
    /// named `body` is left alone.
    fn substitute_value_locals(&self, expr: &str, mode: Subst) -> String {
        let mut out = expr.to_string();
        for name in &self.value_locals {
            let replacement = match mode {
                Subst::Adopt => format!("{name}.adopt(__ic)"),
                Subst::Build => format!("{name}.build()"),
                Subst::Deps => "null".to_string(),
            };
            out = replace_ident(&out, name, &replacement);
        }
        out
    }

    // ── the adopt walk ────────────────────────────────────────────────────────────

    /// Claim `node` from cursor `cur` (advancing it) and return the variable holding
    /// the claimed node. Recurses into element children with a fresh child cursor.
    /// Adopt a *component's* root view off the shared cursor `cur`. A component whose root
    /// is a conditional or a multi-node expression lowers to a `Fragment`, whose children the
    /// server renders as consecutive siblings directly under the host (CSR flattens the same
    /// nodes out of a `DocumentFragment`). Adopt each in sequence; a single-node root
    /// (element / component / list / conditional) is adopted directly. Scoped to the root
    /// walk — a `Fragment` nested as a conditional *branch* still needs a single returned
    /// node, so it stays unsupported (a safe rebuild fallback) in `emit_node`.
    fn emit_root_view(&mut self, cur: &str, view: &ViewNode) {
        if let ViewNode::Fragment(children) = view {
            for child in children {
                self.emit_node(cur, child);
            }
        } else {
            self.emit_node(cur, view);
        }
    }

    fn emit_node(&mut self, cur: &str, node: &ViewNode) -> String {
        match node {
            ViewNode::Element { tag, props, children } => {
                let var = self.fresh("el");
                self.uses.claim_element = true;
                self.line(format!("const {var} = claimElement({cur}, {});", js_string(tag)));
                // A fully static subtree needs nothing below this line: its attributes are
                // already serialized into the server HTML (`emit_prop` skips `Static`), and
                // claiming an element advances `{cur}` past its entire subtree — the same
                // reason a child component isn't walked into. Descending would emit a
                // `cursor` plus a `claimElement`/`skipNode` per node only to arrive back
                // here, which is what made a large static page's module enormous. The
                // binding stays because root positions (page, list item, branch) use it.
                if static_tree::is_static(node) {
                    return var;
                }
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
            // A child component: claim its host element and wire any dynamic props onto it,
            // but do NOT recurse into its *own* structure — the component self-adopts that when
            // it upgrades (its `connectedCallback` runs at `define`, before this walk), so
            // claiming the host advances the cursor past its whole subtree. Slotted **children**
            // (2.1d) are the exception: they're *this* view's JSX, server-rendered inside the
            // host at the component's `{children}` slot, so we own their reactivity — locate the
            // slot (`hydrateSlot`) and adopt them there.
            ViewNode::Component { name, props, children } => {
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
                if !children.is_empty() {
                    self.emit_slotted_children(&var, children);
                }
                var
            }
            // Static text: a real text node in the server HTML — step the cursor over it.
            ViewNode::Text(_) => {
                self.uses.skip_node = true;
                self.line(format!("skipNode({cur});"));
                String::new()
            }
            // A JSX-value-local hole (`{body}` where `const body = <div/>`, Phase 2.1e): the
            // server rendered the value's subtree inline in the `<!--$-->…<!--/-->` markers.
            // Adopt it in place (`hydrateHole` + the local's `adopt` closure) instead of the
            // claimText path, which would strip the subtree and let bindText rebuild it — a
            // flash plus a rebuild cascade through any island the value contains.
            ViewNode::Dynamic { expr } if self.value_locals.iter().any(|n| n == self.code(*expr).trim()) => {
                let name = self.code(*expr).trim().to_string();
                self.uses.hydrate_hole = true;
                self.line(format!("hydrateHole({cur}, {name}.adopt);"));
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
            ViewNode::List { source, source_branches, item_param, index_param, item, key, preamble } => {
                self.emit_list(cur, *source, source_branches, item_param, index_param.as_deref(), item, *key, preamble);
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
            // A page/layout `{children}` slot (2.1c): the nested route's server DOM sits inline
            // here, bracketed by `<!--[-->…<!--]-->`. `props.children` is the router-supplied
            // adopt thunk — hand it our cursor so it claims the nested subtree and advances the
            // cursor past it; then close the region. (A component's `{children}` uses
            // `children_local`, which isn't adoptable yet — it errors below.)
            ViewNode::Children if self.lowered.page_param.is_some() => {
                let param = self.lowered.page_param.clone().unwrap();
                self.uses.claim_region = true;
                self.line(format!("claimRegionStart({cur});"));
                self.line(format!("{param}.children({cur});"));
                self.line(format!("claimRegionEnd({cur});"));
                String::new()
            }
            // A *component's* light-DOM `{children}` slot (2.1d): the slotted nodes are the
            // parent's JSX, whose reactivity the parent wires via `hydrateSlot`. Here the
            // component just steps its own cursor over the `<!--c[-->…<!--c]-->` region.
            ViewNode::Children if self.lowered.children_local.is_some() => {
                let local = self.lowered.children_local.clone().unwrap();
                self.uses.skip_slot = true;
                // Assign (never re-declare): the binding is `let` in the adopt branch's scope,
                // and this walk may run nested inside a value local's `adopt` closure. Seeding
                // it here is what makes that local's `build` fallback able to re-slot.
                self.line(format!("{local} = skipSlot({cur});"));
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
        source_branches: &[ViewNode],
        item_param: &str,
        index_param: Option<&str>,
        item: &ViewNode,
        key: Option<ExpressionId>,
        preamble: &[String],
    ) {
        let n = self.list_counter;
        self.list_counter += 1;
        let adopt_fn = format!("{}_hitem{}", self.base, n);
        let build_fn = format!("{}_item{}", self.base, n);

        // The adopt-item walk (claims one server item subtree off the shared cursor).
        self.emit_adopt_item_fn(&adopt_fn, item, item_param, index_param, preamble);
        // The CSR build for items reconciled in *after* first paint — the same subtree the
        // component/page's own CSR arm builds, so no new helper imports are introduced.
        let (build_lines, tmpls) =
            emit_build_item_fn(self.lowered, &build_fn, item, item_param, index_param, preamble);
        self.templates.extend(tmpls);
        for l in build_lines {
            self.line(l);
        }

        let source_code = self.list_source_code(source, source_branches);
        // Key params must match the callback's real item/index names (mirrors csr) so
        // a `key={index}` reads the actual index binding, not a synthetic `_index`.
        let idx = index_param.unwrap_or("_index");
        let key_fn = match key {
            Some(k) => format!("({item_param}, {idx}) => ({})", self.code(k)),
            None => "undefined".to_string(),
        };
        self.uses.hydrate_list = true;
        self.bind(format!(
            "hydrateList({cur}, () => ({source_code}), {adopt_fn}, {build_fn}, {key_fn})"
        ));
    }

    /// The list's data expression, with any JSX embedded in it (`[{ icon: <b/> }]`)
    /// replaced by a client node-builder call — the source is re-evaluated on the
    /// client to seed reconciliation, so a data-position element must build a real
    /// DOM node (the server's rendered copy is claimed by the adopt-item walk).
    fn list_source_code(&mut self, source: ExpressionId, source_branches: &[ViewNode]) -> String {
        let template = self.code(source);
        if source_branches.is_empty() {
            return template;
        }
        let mut calls = Vec::with_capacity(source_branches.len());
        for branch in source_branches {
            let n = self.list_counter;
            self.list_counter += 1;
            let build_fn = format!("{}_node{}", self.base, n);
            let (build_lines, tmpls) = emit_build_node_fn(self.lowered, &build_fn, branch);
            self.templates.extend(tmpls);
            for l in build_lines {
                self.line(l);
            }
            calls.push(format!("{build_fn}()"));
        }
        substitute_branches_pub(&template, &calls)
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
        preamble: &[String],
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
        for l in preamble {
            self.line(format!("  {l}"));
        }
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
            let (build_lines, tmpls) = emit_build_node_fn(self.lowered, &build_fn, branch);
            self.templates.extend(tmpls);
            for l in build_lines {
                self.line(l);
            }
            // The adopt fn claims off the shared region cursor `__ic`; the build fn takes none.
            adopt_calls.push(format!("{adopt_fn}(__ic)"));
            build_calls.push(format!("{build_fn}()"));
        }

        let template = self.code(expr);
        let adopt_expr = substitute_branches_pub(&template, &adopt_calls);
        let build_expr = substitute_branches_pub(&template, &build_calls);
        // The deps template: the same expression with every branch replaced by `null`.
        // `hydrateChild`'s region effect must run *something* on first paint to subscribe to
        // the condition's reads, but running the real build there constructs a subtree only to
        // throw it away — and if a branch re-slots the component's `{children}`, `appendChild`
        // moves those live server nodes into the discarded tree, emptying the slot. Evaluating
        // the condition alone subscribes to the same reads and touches no DOM. (Reactivity
        // *inside* a branch rides that branch's own bindText/bindAttr effects.)
        let nulls = vec!["null".to_string(); branches.len()];
        let deps_expr = substitute_branches_pub(&template, &nulls);
        // A branch may be a bare reference to a JSX-value local (`cond ? <a/> : body`): the
        // adopt template claims it off the region cursor, the build template rebuilds it, the
        // deps template drops it.
        let adopt_expr = self.substitute_value_locals(&adopt_expr, Subst::Adopt);
        let build_expr = self.substitute_value_locals(&build_expr, Subst::Build);
        let deps_expr = self.substitute_value_locals(&deps_expr, Subst::Deps);
        self.uses.hydrate_child = true;
        self.bind(format!(
            "hydrateChild({cur}, (__ic) => ({adopt_expr}), () => ({build_expr}), () => ({deps_expr}))"
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

    /// Adopt a child component's slotted children (2.1d): these are *this* view's JSX,
    /// server-rendered inside the component `host` at its `{children}` slot, so their
    /// reactivity is ours to wire. `hydrateSlot` locates the slot by its `<!--c[-->` marker
    /// within the host and hands us a cursor at the first slotted node; the walk claims them
    /// there. Disposers collect into the current sink (the enclosing page/component), so a
    /// mid-walk mismatch or a disconnect tears them down like any other binding.
    fn emit_slotted_children(&mut self, host: &str, children: &[ViewNode]) {
        self.uses.hydrate_slot = true;
        let slot_cur = self.fresh("__sc");
        let saved = std::mem::take(&mut self.lines);
        for child in children {
            self.emit_node(&slot_cur, child);
        }
        let body = std::mem::replace(&mut self.lines, saved);
        self.line(format!("hydrateSlot({host}, ({slot_cur}) => {{"));
        for l in &body {
            self.line(format!("  {l}"));
        }
        self.line("});".to_string());
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
            PropValue::Static(_) | PropValue::Boolean => {} // already serialized into the server HTML
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
            PropValue::Static(_) | PropValue::Boolean => {}
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

/// Split a JSX-value local statement into `(binding name, right-hand side)` when it has an
/// adoptable shape, or `None` when it stays on the safe rebuild fallback.
///
/// The statement must bind one plain identifier (`const body = …`, not a destructuring
/// pattern), and every JSX node in the right-hand side — marked by the templater as a NUL
/// placeholder (`\u{0}i\u{0}`) — must sit in a **node position**, so that substituting an
/// adopt/build call for it produces a valid expression that constructs exactly one subtree:
///
/// - `const body = <div/>` — the whole RHS is the placeholder.
/// - `const body = cond ? <a/> : <b/>` (the layout idiom), with either branch allowed to be
///   `null`/`undefined` instead.
/// - `const body = cond && <a/>`.
///
/// Anything else — `const map = { a: <A/> }`, `const list = [<A/>, <B/>]`, a placeholder in
/// the condition — returns `None`. Those aren't a single positional node, and the object case
/// is never referenced by bare name anyway (the view reads `map.a`), so emitting a dual
/// `{build, adopt}` object for it would be wrong as well as useless.
fn value_local(template: &str) -> Option<(String, String)> {
    let rest = template.trim();
    let rest = rest.strip_suffix(';').unwrap_or(rest).trim();
    let kw = ["const ", "let ", "var "].into_iter().find(|k| rest.starts_with(k))?;
    let after = rest[kw.len()..].trim_start();
    let eq = after.find('=')?;
    let name = after[..eq].trim();
    let is_ident = !name.is_empty()
        && name.chars().enumerate().all(|(i, c)| {
            if i == 0 {
                c.is_ascii_alphabetic() || c == '_' || c == '$'
            } else {
                c.is_ascii_alphanumeric() || c == '_' || c == '$'
            }
        });
    if !is_ident {
        return None;
    }
    let rhs = after[eq + 1..].trim();
    if is_positional_rhs(rhs) {
        Some((name.to_string(), rhs.to_string()))
    } else {
        None
    }
}

/// Is every placeholder in `expr` in a node position (see [`value_local`])?
fn is_positional_rhs(expr: &str) -> bool {
    let e = strip_parens(expr);
    if is_placeholder(e) || is_nullish(e) {
        return true;
    }
    // `cond ? then : else` — the condition must build nothing, the branches must be nodes.
    if let Some(q) = top_level(e, '?') {
        // Guard `??`: that's a nullish coalesce, not a conditional.
        if !e[q + 1..].starts_with('?') && !e[..q].ends_with('?') {
            if let Some(colon) = top_level(&e[q + 1..], ':') {
                let cond = &e[..q];
                let then = &e[q + 1..q + 1 + colon];
                let alt = &e[q + 1 + colon + 1..];
                return !has_placeholder(cond) && is_positional_rhs(then) && is_positional_rhs(alt);
            }
        }
    }
    // `cond && <jsx/>`
    if let Some(i) = top_level(e, '&') {
        if e[i..].starts_with("&&") {
            return !has_placeholder(&e[..i]) && is_positional_rhs(&e[i + 2..]);
        }
    }
    false
}

/// Strip balanced surrounding parentheses and whitespace.
fn strip_parens(s: &str) -> &str {
    let mut s = s.trim();
    while s.starts_with('(') && s.ends_with(')') && top_level(&s[1..s.len() - 1], ')').is_none() {
        s = s[1..s.len() - 1].trim();
    }
    s
}

fn is_placeholder(s: &str) -> bool {
    let s = strip_parens(s);
    s.starts_with('\u{0}') && s.ends_with('\u{0}') && s.matches('\u{0}').count() == 2
}

fn is_nullish(s: &str) -> bool {
    matches!(strip_parens(s), "null" | "undefined" | "false" | "\"\"")
}

fn has_placeholder(s: &str) -> bool {
    s.contains('\u{0}')
}

/// Byte index of the first `needle` at nesting depth 0, outside string/template literals.
/// `None` when there is none (or when the expression is unbalanced).
fn top_level(s: &str, needle: char) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut quote: Option<u8> = None;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
        } else {
            match c {
                b'"' | b'\'' | b'`' => quote = Some(c),
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => {
                    depth -= 1;
                    if depth < 0 && c as char != needle {
                        return None; // unbalanced — not an expression we can reason about
                    }
                }
                _ => {}
            }
            if depth == 0 && c as char == needle {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

/// Replace every whole-identifier occurrence of `ident` in `hay` with `replacement`. A match
/// is whole only when the char before isn't `.`/`_`/`$`/alphanumeric (so `foo.body` and
/// `mybody` are left alone) and the char after isn't `_`/`$`/alphanumeric. `ident` is an
/// ASCII JS identifier (validated by [`value_local_name`]).
fn replace_ident(hay: &str, ident: &str, replacement: &str) -> String {
    let bytes = hay.as_bytes();
    let mut out = String::with_capacity(hay.len());
    let mut i = 0;
    while i < hay.len() {
        if hay[i..].starts_with(ident) {
            let before_ok = i == 0 || {
                let c = bytes[i - 1];
                !(c == b'.' || c == b'_' || c == b'$' || c.is_ascii_alphanumeric())
            };
            let after = i + ident.len();
            let after_ok = after >= hay.len() || {
                let c = bytes[after];
                !(c == b'_' || c == b'$' || c.is_ascii_alphanumeric())
            };
            if before_ok && after_ok {
                out.push_str(replacement);
                i = after;
                continue;
            }
        }
        let ch = hay[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn node_kind(node: &ViewNode) -> &'static str {
    // Lists, conditionals, and `{children}` slots (page/layout via a thunk, component via
    // skipSlot) all have their own adopt arms now (Phase 2.1). Only fragments / multi-node
    // roots remain unadopted; a `Children` reaching here has neither a page_param nor a
    // children_local (a malformed slot).
    match node {
        ViewNode::Children => "`{children}` slot outside a page/layout/component",
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

    #[test]
    fn data_position_jsx_in_list_source_builds_a_client_node() {
        // `[{ icon: <b/> }].map(…)`: the source is re-evaluated on the client to seed
        // reconciliation, so JSX in it must build a real DOM node (the server copy is
        // dropped by the item's node-valued-hole adoption, then rebuilt by bindText).
        let m = emit(
            "export default function P(){ return <ul>{[{icon: <b>ICON</b>}].map((t) => <li>{t.icon}</li>)}</ul>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("function default_node1() {"), "source node builder:\n{}", m.code);
        assert!(
            m.code.contains("hydrateList(__c2, () => ([{icon: default_node1()}]),"),
            "source substitution:\n{}",
            m.code
        );
    }

    #[test]
    fn jsx_in_effect_loop_body_is_templated_in_both_halves() {
        // JSX inside a `$effect` loop body: effects always *build* fresh nodes
        // (SSG doesn't run them, so there's nothing to adopt), and both the CSR
        // factory and the adopt factory must emit the inline builder — never
        // raw JSX or a builder hoisted out of the loop's scope.
        let m = emit(
            "export default function P(){\n\
               let items = $state([]);\n\
               let container = $ref();\n\
               $effect(() => {\n\
                 const groups = [];\n\
                 for (const group of items) { groups.push(<Child group={group} />); }\n\
                 container.replaceChildren(...groups);\n\
               });\n\
               return <div ref={container}></div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(!m.code.contains("<Child"), "raw JSX leaked:\n{}", m.code);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("groups.push((() => {"), "inline builder in adopt effect:\n{}", hyd);
        assert!(hyd.contains("setProp(c0, \"group\", (group));"), "loop local prop:\n{}", hyd);
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
        // The walk lives in `hydrateAt(cursor, …)`; `hydrate(root, …)` is a thin wrapper that
        // seeds the cursor — so a nested route can adopt inline at its layout's `{children}` slot.
        assert!(hyd.contains("export function hydrateAt(__c0)"), "hydrateAt walk:\n{}", hyd);
        assert!(hyd.contains("export function hydrate(__root)"), "hydrate wrapper:\n{}", hyd);
        assert!(hyd.contains("return hydrateAt(cursor(__root));"), "wrapper seeds the cursor:\n{}", hyd);
        assert!(hyd.contains("const el1 = claimElement(__c0, \"div\");"), "claim div off the passed cursor:\n{}", hyd);
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
    fn hydratable_class_prop_component_latches_the_host_class_guard_in_the_constructor() {
        // Regression: a `class` prop shares the host's `class` attribute with the styling
        // hook. A hydrating upgrade fires `attributeChangedCallback("class", "web-…")` for
        // the server-stamped hook attribute *after* the constructor, which would clobber the
        // payload-hydrated prop signal. The constructor must latch `_stampingHostClass` so
        // that upgrade-time callback is ignored (the value from the rich payload stands).
        let m = emit_component(
            "export default function Link({ href, class: c }){ return <a href={href} class={c}>x</a>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // The signal is initialized from the payload…
        assert!(
            m.code.contains("class: signal(__h && \"class\" in __h ? __h[\"class\"]"),
            "class prop reads the payload:\n{}",
            m.code,
        );
        // …and the guard is latched in the constructor, before the closing brace, so the
        // upgrade-time attributeChangedCallback for the server hook attribute is skipped.
        let ctor = m.code.split("constructor() {").nth(1).expect("constructor");
        let ctor = &ctor[..ctor.find("\n  }").expect("constructor closes")];
        assert!(
            ctor.contains("this._stampingHostClass = true;"),
            "constructor latches the host-class guard:\n{}",
            m.code,
        );
        // The guard is honored by attributeChangedCallback.
        assert!(
            m.code.contains("if (this._stampingHostClass) return;"),
            "attributeChangedCallback honors the guard:\n{}",
            m.code,
        );
    }

    #[test]
    fn component_with_a_conditional_root_adopts_via_hydrate_child() {
        // Regression: a component whose root is a conditional (or any multi-node expression)
        // lowers to a `Fragment`. The adopt walk must flatten that fragment root — adopt each
        // child off the host cursor — instead of erroring ("fragment / multi-node root") and
        // forcing a destroy-and-rebuild. That rebuild during hydration wiped the server DOM
        // of child islands nested in the branches (e.g. a `<Link>`/`<web-link>`), racing with
        // their own adopt and producing per-component `HydrationMismatch`es.
        let m = emit_component(
            "export default function C(props){ const link = props.link || {}; \
             return link.external ? <a href={link.href}>{link.label}</a> : <b>{link.label}</b>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Adopts (not RebuildIfServerChildren): the dual switch + a shared build closure.
        assert!(m.code.contains("const __build = () => runBuild(() => {"), "shared build closure:\n{}", m.code);
        assert!(m.code.contains("if (isHydrating() && this.firstChild) {"), "dual switch:\n{}", m.code);
        // The root conditional is claimed via `hydrateChild` off the host's cursor.
        assert!(m.code.contains("const __c0 = cursor(this);"), "cursor over host:\n{}", m.code);
        assert!(m.code.contains("hydrateChild(__c0,"), "root conditional adopts via hydrateChild:\n{}", m.code);
        // It did NOT fall back to the discard-and-rebuild view.
        assert!(!m.code.contains("if (this.firstChild) this.replaceChildren();"), "no rebuild fallback:\n{}", m.code);
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
        assert!(m.code.contains("const __build = () => runBuild(() => {"), "shared build closure:\n{}", m.code);
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
            m.code.contains("import { signal, bindText, handleError, isHydrating, runBuild, HydrationMismatch, reportError }"),
            "hydration helpers imported:\n{}",
            m.code
        );
        // No standalone `hydrate` export — a component hydrates via its class, not a factory.
        assert!(!m.code.contains("export function hydrate"), "no page factory:\n{}", m.code);
    }

    #[test]
    fn a_build_that_can_run_mid_hydration_is_wrapped_in_run_build() {
        // Regression (docs/HYDRATION.md §3.5): a component the hydrate backend can't adopt —
        // here because it binds JSX inside an object literal (`const parts = { body: <jsx/> }`),
        // which isn't a single positional node to claim — falls to `RebuildIfServerChildren`
        // and rebuilds on first paint. (The plain `const body = <jsx/>` idiom that took down the
        // docs site *does* adopt now, Phase 2.1e; this uses a shape that still can't.) That
        // rebuild runs while `isHydrating()` is still set, so its fresh child islands must
        // build, not adopt DOM this component just created. Codegen brackets the build in
        // `runBuild(() => …)`, which clears the flag for the build's synchronous span.
        let m = emit_component(
            "export default function Panel({ framed, children }){ const parts = { body: <div class=\"b\">{children}</div> }; \
             return framed ? <section>{parts.body}</section> : parts.body; }",
        );
        // JSX-as-value is a *non-fatal* adopt error: it's reported (so the gap is visible) but
        // the module still emits — with this component demoted to `RebuildIfServerChildren`.
        assert!(
            m.errors.iter().any(|e| e.contains("JSX-as-value")),
            "the object-embedded JSX makes it non-adoptable:\n{:?}",
            m.errors,
        );
        // The RebuildIfServerChildren build is wrapped in runBuild.
        assert!(m.code.contains("runBuild(() => {"), "build wrapped in runBuild:\n{}", m.code);
        assert!(m.code.contains("runBuild"), "runBuild imported:\n{}", m.code);
        // The server-DOM discard still gates on the *true* flag (outside the wrapper), so a
        // client-nav build with call-site children doesn't wrongly clear them — and it rescues
        // the slotted content out of the rendered view first, so the rebuild can re-slot it.
        assert!(
            m.code.contains(
                "if (isHydrating() && this.firstChild) { this._serverSlot = slotChildren(this); this.replaceChildren(); }"
            ),
            "server-DOM discard reads the real flag and rescues the slot:\n{}",
            m.code,
        );
        assert!(
            m.code.contains("const children = this._serverSlot ?? Array.from(this.childNodes);"),
            "the rebuild captures the rescued slot children:\n{}",
            m.code,
        );
    }

    #[test]
    fn jsx_value_local_hole_adopts_in_place() {
        // Phase 2.1e — the docs-layout idiom: a `const body = <jsx/>` local rendered at a
        // `{body}` hole. The hole must *adopt* the server subtree in place (`hydrateHole` +
        // the local's `adopt` closure), not strip-and-rebuild it via claimText.
        let m = emit(
            "export default function P(){ const body = <div class=\"b\"><span>hi</span></div>; \
             return <section>{body}</section>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        // The local is a dual `{ build, adopt }` object; the build delegates to a hoisted CSR
        // fn. `base` is the export name, so a default-export page's build fn is
        // `default_vbuild0`.
        assert!(hyd.contains("const body = {"), "dual object:\n{}", hyd);
        assert!(hyd.contains("default_vbuild0()"), "build delegates to the hoisted CSR fn:\n{}", hyd);
        assert!(hyd.contains("adopt: (__vc) => (default_vadopt0(__vc)),"), "adopt closure:\n{}", hyd);
        assert!(hyd.contains("claimElement(__vc, \"div\")"), "adopt walk claims body root:\n{}", hyd);
        // The `{body}` hole adopts via hydrateHole, not claimText.
        assert!(hyd.contains("hydrateHole(__c2, body.adopt);"), "hole adopts in place:\n{}", hyd);
        assert!(!hyd.contains("claimText"), "no strip-and-rebuild:\n{}", hyd);
        assert!(m.code.contains("hydrateHole"), "hydrateHole imported:\n{}", m.code);
    }

    #[test]
    fn jsx_value_local_bare_branch_reference_adopts_and_builds() {
        // The frame-toggle shape: `frame ? <shell>{body}</shell> : body`. The bare `: body`
        // branch of the root dynamic node must adopt off the region cursor (`body.adopt(__ic)`)
        // and, for the build/swap arm, rebuild (`body.build()`) — never insert the dual object.
        let m = emit(
            "export default function P(props){ const body = <div class=\"b\">x</div>; \
             return props.framed ? <section>{body}</section> : body; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("body.adopt(__ic)"), "bare branch adopts off the region cursor:\n{}", hyd);
        assert!(hyd.contains("body.build()"), "bare branch rebuilds in the swap arm:\n{}", hyd);
    }

    #[test]
    fn jsx_value_local_component_with_slot_adopts_not_rebuilds() {
        // The real DocsLayout is a *component* with a `{children}` slot inside its JSX-value
        // local. It must now Adopt (the braced dual switch, not the RebuildIfServerChildren
        // one-liner), and the value local's adopt walk must step over the component's own slot
        // with skipSlot while the `{body}` hole adopts the local in place.
        let m = emit_component(
            "export default function Panel({ children }){ const body = <div class=\"b\"><article>{children}</article></div>; \
             return <section>{body}</section>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Adopts: the braced dual switch (RebuildIfServerChildren is the `… replaceChildren();`
        // one-liner instead), a `{body}` hole that adopts, and a slot the walk steps over.
        assert!(m.code.contains("if (isHydrating() && this.firstChild) {"), "braced dual switch:\n{}", m.code);
        assert!(
            !m.code.contains("if (isHydrating() && this.firstChild) this.replaceChildren();"),
            "not the RebuildIfServerChildren one-liner:\n{}",
            m.code,
        );
        assert!(m.code.contains("hydrateHole("), "hole adopts the value local:\n{}", m.code);
        assert!(m.code.contains("skipSlot("), "component steps over its slot in the value local:\n{}", m.code);
    }

    #[test]
    fn value_local_build_fallback_sees_the_children_local_in_the_adopt_scope() {
        // Regression (docs site: `ReferenceError: __children is not defined` thrown from a value
        // local's `build`): the adopt branch emits the value local's CSR `build` fn, whose body
        // re-slots the children local — but the *capture* of that local lives only inside the
        // sibling `__build` closure, so in the adopt scope the name was free. The adopt branch
        // must declare it itself and seed it from `skipSlot`.
        //
        // Uses the props-object form (`props.children` → the synthesized `__children` local),
        // which is the shape the docs layout hit.
        let m = emit_component(
            "export default function Panel(props){ const body = <div class=\"b\"><article>{props.children}</article></div>; \
             return <section>{body}</section>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let adopt = m
            .code
            .find("if (isHydrating() && this.firstChild) {")
            .map(|i| m.code[i..].to_string())
            .expect("adopt branch");
        // The binding is declared in the adopt branch, ahead of the build fn that closes over it…
        let decl = adopt.find("let __children = [];").expect("children local declared in adopt scope");
        let build_fn = adopt.find("function default_vbuild0()").expect("value local build fn");
        assert!(decl < build_fn, "declared before the build fn that closes over it:\n{}", adopt);
        // …and seeded (assigned, not re-declared) from the slot walk.
        assert!(adopt.contains("__children = skipSlot("), "slot walk seeds the local:\n{}", adopt);
        assert!(
            !adopt.contains("const __children = skipSlot("),
            "seeds by assignment — a `const` here would shadow inside the adopt closure:\n{}",
            adopt,
        );
        // The build fn still re-slots, and now resolves.
        assert!(adopt.contains("of __children)"), "build fn re-slots the children:\n{}", adopt);
    }

    #[test]
    fn value_local_build_is_never_called_on_the_subscribe_only_run() {
        // Companion to the above. Seeding the children local is only safe because nothing
        // rebuilds this branch on first paint: a rebuild would `appendChild` the *live*
        // slotted nodes into a throwaway tree and empty the slot. `hydrateChild` gets a
        // separate deps closure (branches → `null`) for its subscribe-only run, so `build()`
        // runs only for a genuine later swap — no memo needed.
        let m = emit_component(
            "export default function Panel(props){ const frame = props.frame === true; \
             const body = <div class=\"b\"><article>{props.children}</article></div>; \
             return frame ? <div class=\"shell\">{body}</div> : body; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let adopt = m
            .code
            .find("if (isHydrating() && this.firstChild) {")
            .map(|i| m.code[i..].to_string())
            .expect("adopt branch");
        assert!(adopt.contains("build: () => (default_vbuild0()),"), "plain builder:\n{}", adopt);
        assert!(adopt.contains("return el0;"), "adopt returns its claimed root:\n{}", adopt);
        // The deps closure drops the value-local reference entirely — the first run evaluates
        // the condition and nothing else.
        assert!(
            adopt.contains("() => (frame ? null : null)"),
            "deps closure nulls the branches:\n{}",
            adopt,
        );
        // The swap arm still routes through `build()`.
        assert!(adopt.contains("body.build()"), "swap arm calls build():\n{}", adopt);
    }

    #[test]
    fn conditional_jsx_value_local_adopts_the_rendered_branch() {
        // The `BlogLayout` shape: `const body = post ? <post-view/> : <index-view/>`, rendered
        // at a `{body}` hole. Both branches are node positions, so the local is adoptable — the
        // condition is deterministic across server and client, so evaluating the adopt template
        // selects the same branch the server rendered.
        let m = emit_component(
            "export default function L(props){ const post = props.post; \
             const body = post ? <article class=\"p\">{props.children}</article> : <div class=\"i\">i</div>; \
             return <main>{body}</main>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("const body = {"), "dual object:\n{}", m.code);
        // One adopt fn + one build fn per branch, spliced back into the original conditional.
        assert!(
            m.code.contains("adopt: (__vc) => (post ? default_vadopt0(__vc) : default_vadopt1(__vc)),"),
            "adopt template keeps the condition:\n{}",
            m.code,
        );
        assert!(
            m.code.contains("build: () => (post ? default_vbuild0() : default_vbuild1()),"),
            "build template keeps the condition:\n{}",
            m.code,
        );
        assert!(m.code.contains("hydrateHole"), "the hole adopts in place:\n{}", m.code);
    }

    #[test]
    fn logical_and_jsx_value_local_is_adoptable() {
        let m = emit_component(
            "export default function L(props){ const extra = props.on && <span>x</span>; \
             return <div>{extra}</div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("adopt: (__vc) => (props.on.value && default_vadopt0(__vc)),"),
            "adopt template keeps the guard:\n{}",
            m.code,
        );
    }

    #[test]
    fn array_embedded_jsx_value_stays_non_adoptable() {
        // A placeholder that isn't in a node position of a conditional — an array element —
        // stays on the rebuild fallback: substituting an adopt call there would claim DOM that
        // isn't at the cursor.
        let m = emit_component(
            "export default function C(props){ const tabs = [<a>1</a>, <b>2</b>]; \
             return <section>{tabs[0]}</section>; }",
        );
        assert!(m.errors.iter().any(|e| e.contains("JSX-as-value")), "still errors:\n{:?}", m.errors);
        assert!(!m.code.contains("hydrateHole"), "no in-place adoption:\n{}", m.code);
    }

    #[test]
    fn object_embedded_jsx_value_stays_non_adoptable() {
        // Only the bare `const NAME = <jsx>` shape is adoptable. A JSX value inside an object
        // (or array, or ternary) isn't one positional node — it stays on the rebuild fallback.
        let m = emit_component(
            "export default function C({ children }){ const o = { body: <div>{children}</div> }; \
             return <section>{o.body}</section>; }",
        );
        assert!(m.errors.iter().any(|e| e.contains("JSX-as-value")), "still errors:\n{:?}", m.errors);
        assert!(!m.code.contains("hydrateHole"), "no in-place adoption:\n{}", m.code);
    }

    #[test]
    fn adopt_component_emits_on_mount_inside_each_scoped_path() {
        // Regression: an Adopt component's setup (its locals) is emitted once inside the
        // `__build` closure and again inside the adopt branch — two separate scopes. An
        // `onMount` callback closes over those locals, so it must be emitted *inside* both
        // paths, not hoisted after the switch (where the locals don't exist → a runtime
        // `ReferenceError` that crashed every SSG page using `onMount`).
        let m = emit_component(
            "export default function C(){ let n=$state(0); onMount(() => { n.value; }); \
             return <button onclick={() => n++}>Count {n}</button>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // The mount wrapper is duplicated: one copy per scoped path (build + adopt).
        let mounts = m.code.matches("if (typeof __d === \"function\") this._cleanups.push(__d);").count();
        assert_eq!(mounts, 2, "onMount emitted once per scoped path:\n{}", m.code);
        // And it must sit *before* the `};` that closes `__build` — i.e. inside the closure,
        // not after the `} else { __build(); }` switch at the connectedCallback top level.
        let build_open = m.code.find("const __build = () => runBuild(() => {").expect("build closure");
        let first_mount = m.code[build_open..].find("const __d =").expect("mount in build") + build_open;
        let build_close = m.code[build_open..].find("\n    });\n").expect("build closes") + build_open;
        assert!(first_mount < build_close, "onMount inside __build closure:\n{}", m.code);
    }

    #[test]
    fn adopt_component_emits_dom_hooks_inside_each_scoped_path() {
        // Like `onMount`, the desugared observer closures ride the mounts string csr
        // splices into both the `__build` closure and the adopt branch.
        let m = emit_component(
            "export default function C(){ let n=$state(0); onResize((entry) => { n.value; }); \
             return <button onclick={() => n++}>Count {n}</button>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert_eq!(
            m.code.matches("new ResizeObserver(").count(),
            2,
            "observer setup emitted once per scoped path:\n{}",
            m.code
        );
        let build_open = m.code.find("const __build = () => runBuild(() => {").expect("build closure");
        let first_hook = m.code[build_open..].find("new ResizeObserver(").expect("hook in build") + build_open;
        let build_close = m.code[build_open..].find("\n    });\n").expect("build closes") + build_open;
        assert!(first_hook < build_close, "observer setup inside __build closure:\n{}", m.code);
    }

    #[test]
    fn hydrate_page_emits_dom_hooks() {
        let m = emit(
            "export default function P(){ onVisibilityChange((v) => console.log(v)); onMediaQuery(\"(min-width: 768px)\", (q) => console.log(q)); return <div>hi</div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("__lifecycle.mounts.push(() => { const __cb = ("), "hydrate: {hyd}");
        assert!(hyd.contains("new IntersectionObserver("), "hydrate: {hyd}");
        assert!(hyd.contains("window.matchMedia((\"(min-width: 768px)\"));"), "hydrate: {hyd}");
        assert!(hyd.contains(".__lifecycle = __lifecycle;"), "hydrate: {hyd}");
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
    fn component_with_children_slot_adopts_stepping_over_its_slot() {
        // A component that takes `{children}` now adopts (Phase 2.1d): the dual class's adopt
        // arm claims the component's own structure and steps its cursor over the `{children}`
        // slot via `skipSlot` (the slotted content is the *parent's* JSX — the parent wires its
        // reactivity, §2.1d). The build arm still captures the call-site children for client nav.
        let m = emit_component(
            "export default function Card({ children }){ return <div class=\"card\"><b>x</b>{children}</div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Adopt arm: walk the component's own structure, step over the slot.
        assert!(m.code.contains("if (isHydrating() && this.firstChild) {"), "dual switch:\n{}", m.code);
        assert!(m.code.contains("const __c0 = cursor(this);"), "adopt walk present:\n{}", m.code);
        assert!(m.code.contains("claimElement(__c0, \"div\");"), "claim the view root:\n{}", m.code);
        assert!(m.code.contains("skipSlot(__c2);"), "step over the {{children}} slot:\n{}", m.code);
        // `<b>x</b>` is fully static, so claiming it covers its whole subtree — no cursor
        // into it and no `skipNode` for its text.
        assert!(!m.code.contains("cursor(el3)"), "static child not walked into:\n{}", m.code);
        assert!(!m.code.contains("skipNode"), "no per-node skip inside static markup:\n{}", m.code);
        // Build arm (client nav) still captures the call-site children.
        // The build arm can also run over a server-rendered host (mismatch recovery), so its
        // capture prefers the slot nodes rescued from the markers.
        assert!(
            m.code.contains("const children = this._serverSlot ?? Array.from(this.childNodes);"),
            "build-arm capture:\n{}",
            m.code,
        );
        assert!(m.code.contains("import { cursor, claimElement, skipSlot }"), "skipSlot imported:\n{}", m.code);
    }

    #[test]
    fn parent_adopts_a_components_slotted_children() {
        // The other half of §2.1d: a page composing `<Card>…reactive JSX…</Card>` owns the
        // slotted content's reactivity, so its adopt walk claims the host then adopts the
        // children into the component's slot via `hydrateSlot` (which locates `<!--c[-->`).
        let m = emit(
            "import Card from \"./Card\"; export default function P(){ let n=$state(0); return <main><Card><button onclick={() => n++}>c {n}</button></Card></main>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        assert!(hyd.contains("claimElement(__c2, Card.tag);"), "claim the component host:\n{}", hyd);
        assert!(hyd.contains("hydrateSlot(c3, (__sc4) => {"), "adopt slotted children in the host slot:\n{}", hyd);
        assert!(hyd.contains("const el5 = claimElement(__sc4, \"button\");"), "claim the slotted button:\n{}", hyd);
        assert!(hyd.contains("el5.onclick = () => n.value++;"), "wire the parent's reactivity onto it:\n{}", hyd);
        assert!(m.code.contains("hydrateSlot"), "hydrateSlot imported:\n{}", m.code);
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
            hyd.contains("hydrateChild(__c2, (__ic) => (open.value ? default_hnode0(__ic) : default_hnode1(__ic)), () => (open.value ? default_node0() : default_node1()), () => (open.value ? null : null))"),
            "hydrateChild call:\n{}",
            hyd
        );
        assert!(m.code.contains("hydrateChild"), "hydrateChild imported:\n{}", m.code);
    }

    #[test]
    fn layout_adopts_its_children_slot_via_the_router_thunk() {
        // A layout hydrates (Phase 2.1c): its `{children}` slot is a `<!--[-->…<!--]-->`
        // region whose content is the nested route's server DOM. The layout hands its own
        // cursor to `props.children` (the router-supplied adopt thunk), which claims the
        // nested subtree and advances the cursor; the layout then closes the region.
        let m = emit(
            "export default function Layout({ children }){ return <main><nav>N</nav>{children}</main>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        let hyd = hydrate_fn(&m.code);
        // The walk takes the layout's props (so `props.children` resolves to the thunk).
        assert!(hyd.contains("export function hydrateAt(__c0, __props)"), "hydrateAt takes props:\n{}", hyd);
        assert!(hyd.contains("claimElement(__c0, \"main\");"), "claim layout root:\n{}", hyd);
        // At the slot: open the region, hand the cursor to the children thunk, close it.
        assert!(hyd.contains("claimRegionStart(__c2);"), "open children region:\n{}", hyd);
        assert!(hyd.contains("__props.children(__c2);"), "hand cursor to the children thunk:\n{}", hyd);
        assert!(hyd.contains("claimRegionEnd(__c2);"), "close children region:\n{}", hyd);
        assert!(
            m.code.contains("claimRegionStart, claimRegionEnd"),
            "region claim helpers imported:\n{}",
            m.code
        );
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
