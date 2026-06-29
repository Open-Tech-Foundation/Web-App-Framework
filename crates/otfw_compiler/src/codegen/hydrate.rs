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

use crate::codegen::csr::{event_options, is_event, is_listener, js_string};
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

/// Which runtime helpers the generated code references (drives the import header).
#[derive(Default)]
struct Uses {
    signal: bool,
    computed: bool,
    effect: bool,
    bind_text: bool,
    bind_attr: bool,
    read_context: bool,
    cursor: bool,
    claim_element: bool,
    claim_text: bool,
    skip_node: bool,
}

impl Uses {
    fn names(&self) -> Vec<&'static str> {
        let mut n = Vec::new();
        // Reactivity helpers — shared with CSR.
        if self.signal {
            n.push("signal");
        }
        if self.computed {
            n.push("computed");
        }
        if self.effect {
            n.push("effect");
        }
        if self.bind_text {
            n.push("bindText");
        }
        if self.bind_attr {
            n.push("bindAttr");
        }
        if self.read_context {
            n.push("readContext");
        }
        // Node-acquisition helpers — the Hydrate-only additions.
        if self.cursor {
            n.push("cursor");
        }
        if self.claim_element {
            n.push("claimElement");
        }
        if self.claim_text {
            n.push("claimText");
        }
        if self.skip_node {
            n.push("skipNode");
        }
        n
    }
}

/// Emit a whole module. Pages/layouts become hydrate factories; co-located Custom
/// Elements are not adopted yet (a page that composes a child component reports a
/// diagnostic — Phase 2.1).
pub fn emit_module(
    components: &[Lowered],
    module_stmts: &[BodyItem],
    module_exprs: &ExprTable,
) -> HydrateModule {
    let mut uses = Uses::default();
    let mut errors = Vec::new();
    let mut bodies = Vec::new();
    let mut user_imports: Vec<String> = Vec::new();
    let mut runtime_imports: Vec<String> = Vec::new();

    for c in components {
        if !c.is_page {
            errors.push(format!(
                "hydrate: child component <{}> is not supported yet (Phase 2.1); \
                 only pages/layouts hydrate so far",
                c.name
            ));
            continue;
        }
        let mut e = Emitter::new(&c.exprs);
        let body = e.page(c);
        merge_uses(&mut uses, &e.uses);
        errors.extend(e.errors);
        bodies.push(body);
        for i in &c.imports {
            if !user_imports.contains(i) {
                user_imports.push(i.clone());
            }
        }
        for r in &c.runtime_imports {
            if !runtime_imports.contains(r) {
                runtime_imports.push(r.clone());
            }
        }
    }

    // Preserved module-level statements (shared consts/data). JSX-as-value is not
    // adoptable yet (it builds new nodes); report it.
    let mut module_code = String::new();
    {
        let mut e = Emitter::new(module_exprs);
        for item in module_stmts {
            e.emit_stmt(item, &mut module_code);
        }
        merge_uses(&mut uses, &e.uses);
        errors.extend(e.errors);
    }

    let mut code = String::new();
    if !user_imports.is_empty() {
        code.push_str(&user_imports.join("\n"));
        code.push('\n');
    }
    code.push_str(&import_header(&uses, &runtime_imports));
    code.push_str(&module_code);
    for body in bodies {
        code.push_str(&body);
    }
    HydrateModule { code, errors }
}

fn merge_uses(into: &mut Uses, from: &Uses) {
    into.signal |= from.signal;
    into.computed |= from.computed;
    into.effect |= from.effect;
    into.bind_text |= from.bind_text;
    into.bind_attr |= from.bind_attr;
    into.read_context |= from.read_context;
    into.cursor |= from.cursor;
    into.claim_element |= from.claim_element;
    into.claim_text |= from.claim_text;
    into.skip_node |= from.skip_node;
}

fn import_header(uses: &Uses, runtime_imports: &[String]) -> String {
    let mut names: Vec<String> = uses.names().into_iter().map(str::to_string).collect();
    for r in runtime_imports {
        if !names.contains(r) {
            names.push(r.clone());
        }
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
            self.uses.effect = true;
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
        let export = &lowered.ir.id.export;
        let header = if export == "default" {
            format!("export default function ({params}) {{\n")
        } else {
            format!("export function {export}({params}) {{\n")
        };
        format!("{header}{}  return {root};\n}}\n", self.render("  "))
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

    fn emit_stmt(&mut self, item: &BodyItem, out: &mut String) {
        match item {
            BodyItem::Signal(decl) => self.emit_decl(decl),
            BodyItem::Raw(stmt) => out.push_str(&format!("{stmt}\n")),
            BodyItem::Jsx { .. } => {
                self.errors.push("hydrate: JSX-as-value is not supported yet (Phase 2.1)".into());
            }
        }
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
            SignalKind::Context => {
                self.uses.read_context = true;
                self.line(format!("const {} = readContext({});", decl.name, decl.init));
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
                self.uses.bind_text = true;
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
                    self.uses.bind_attr = true;
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

    #[test]
    fn page_adopts_static_structure_and_text_hole() {
        let m = emit(
            "export default function P(){ let n=$state(3); return <div class=\"box\"><h1>Count {n}</h1></div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        // Reactive helpers + claim helpers in the header.
        assert!(m.code.contains("import { signal, bindText, cursor, claimElement, claimText, skipNode }"), "header:\n{}", m.code);
        // Factory takes the container and adopts from a cursor — never creates a node.
        assert!(m.code.contains("export default function (__root)"), "shape:\n{}", m.code);
        assert!(m.code.contains("const __c0 = cursor(__root);"), "root cursor:\n{}", m.code);
        assert!(m.code.contains("const el1 = claimElement(__c0, \"div\");"), "claim div:\n{}", m.code);
        assert!(m.code.contains("claimElement(__c2, \"h1\");"), "claim h1:\n{}", m.code);
        assert!(m.code.contains("skipNode(__c4);"), "skip static text:\n{}", m.code);
        assert!(m.code.contains("claimText(__c4);"), "claim text hole:\n{}", m.code);
        assert!(m.code.contains("bindText(t5, () => (n.value));"), "wire text:\n{}", m.code);
        assert!(!m.code.contains("createElement"), "no node creation:\n{}", m.code);
        assert!(!m.code.contains("appendChild"), "no appends:\n{}", m.code);
        // Static attribute is already in the server HTML — not re-applied.
        assert!(!m.code.contains("setAttribute"), "static attr skipped:\n{}", m.code);
    }

    #[test]
    fn dynamic_attribute_and_event_wire_onto_claimed_element() {
        let m = emit(
            "export default function P(){ let on=$state(false); return <button class={on ? \"on\" : \"\"} onclick={() => on = !on}>go</button>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(m.code.contains("claimElement(__c0, \"button\");"), "claim button:\n{}", m.code);
        assert!(m.code.contains("bindAttr(el1, \"class\","), "dyn attr:\n{}", m.code);
        assert!(m.code.contains("el1.onclick = () => on.value = !on.value;"), "event:\n{}", m.code);
        assert!(m.code.contains("skipNode("), "static 'go' text skipped:\n{}", m.code);
    }

    #[test]
    fn listener_modifier_uses_add_event_listener() {
        let m = emit(
            "export default function P(){ return <div onscroll:passive={() => {}}>x</div>; }",
        );
        assert!(m.is_complete(), "errors: {:?}", m.errors);
        assert!(
            m.code.contains("el1.addEventListener(\"scroll\", () => {}, { passive: true });"),
            "listener:\n{}",
            m.code
        );
    }

    #[test]
    fn child_component_reports_a_diagnostic() {
        let m = emit(
            "import Counter from \"./Counter\"; export default function P(){ return <div><Counter/></div>; }",
        );
        assert!(!m.is_complete());
        assert!(m.errors.iter().any(|e| e.contains("child component")), "errors: {:?}", m.errors);
    }

    #[test]
    fn list_reports_a_diagnostic() {
        let m = emit(
            "export default function P(){ return <ul>{[1,2,3].map(x => <li>{x}</li>)}</ul>; }",
        );
        assert!(!m.is_complete());
        assert!(m.errors.iter().any(|e| e.contains("list")), "errors: {:?}", m.errors);
    }
}
