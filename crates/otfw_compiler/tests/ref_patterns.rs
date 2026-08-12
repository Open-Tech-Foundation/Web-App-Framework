//! Every real-world React callback-ref use case, expressed with this framework's
//! native primitives (`$ref` + `$effect`/`onMount`/`onCleanup`/`$expose`) — and a
//! check that a function-valued `ref` is instead rejected with guidance.
//!
//! These are the "React counterparts": each test is the framework's answer to a
//! pattern that in React would reach for a callback ref, proving no capability is
//! lost by not supporting them.
use std::path::Path;

use otfw_compiler::codegen::csr::{emit_component, emit_page};
use otfw_compiler::lower::{function_ref_diagnostic, lower_component, lower_module};
use otfw_compiler::codegen::csr;
use otfw_compiler::parse::ParseSession;

fn compile_component(source: &str) -> String {
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("C.tsx"), source);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    let lowered = lower_component("/app/components/C.tsx", &parsed.program, source, false)
        .expect("a component");
    let m = emit_component(&lowered);
    assert!(m.errors.is_empty(), "codegen errors: {:?}\n{}", m.errors, m.code);
    m.code
}

fn compile_page(source: &str) -> String {
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("page.tsx"), source);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    let lowered = lower_component("/app/page.tsx", &parsed.program, source, true).expect("a page");
    let m = emit_page(&lowered);
    assert!(m.errors.is_empty(), "codegen errors: {:?}\n{}", m.errors, m.code);
    m.code
}

// React: `ref={(node) => setHeight(node.getBoundingClientRect().height)}` — re-fires
// when the node identity changes.
// Framework: a reactive `$ref` read inside `$effect` re-runs whenever the node is
// (re)assigned, so a `<input>`↔`<textarea>` swap re-measures with the new node.
#[test]
fn measure_reactively_via_ref_effect() {
    let code = compile_component(
        "export default function Box() {\n  let el = $ref(null);\n  $effect(() => { if (el) measure(el); });\n  return <div ref={el} />;\n}",
    );
    assert!(code.contains("const el = signal(null);"), "$ref is a reactive signal:\n{code}");
    assert!(code.contains("el.value = el0;"), "{code}");
    // The effect reads the ref (subscribing) and re-runs on reassignment.
    assert!(code.contains("effect(() => { if (el.value) measure(el.value); })"), "{code}");
}

// React: focus/scroll an element once it exists via a ref callback.
// Framework: `$ref` + `onMount` (runs after the view is appended).
#[test]
fn focus_on_mount_via_ref() {
    let code = compile_page(
        "export default function Login() {\n  let el = $ref(null);\n  onMount(() => el.focus());\n  return <input ref={el} />;\n}",
    );
    assert!(code.contains("el.value = el0;"), "{code}");
    assert!(code.contains("__lifecycle.mounts.push(() => el.value.focus())"), "{code}");
}

// React: initialize an imperative library on a node and dispose it on unmount
// (React 19: `ref={(node) => { const x = init(node); return () => x.destroy(); }}`).
// Framework: `onMount` returning a teardown function — collected into the cleanup sink.
#[test]
fn init_and_teardown_third_party_via_onmount() {
    let code = compile_component(
        "export default function Editor() {\n  let el = $ref(null);\n  onMount(() => { const cm = init(el); return () => cm.destroy(); });\n  return <div ref={el} />;\n}",
    );
    assert!(code.contains("const cm = init(el.value)"), "{code}");
    // A returned function becomes additional teardown run on disconnect.
    assert!(
        code.contains("if (typeof __d === \"function\") this._cleanups.push(__d);"),
        "onMount cleanup not wired:\n{code}"
    );
}

// React: the `null`-call of a callback ref, used for teardown on detach.
// Framework: `onCleanup` — the disposer runs on disconnect.
#[test]
fn teardown_on_detach_via_oncleanup() {
    let code = compile_component(
        "export default function W() {\n  let el = $ref(null);\n  onCleanup(() => teardown(el));\n  return <div ref={el} />;\n}",
    );
    assert!(code.contains("this._cleanups.push(() => teardown(el.value));"), "{code}");
}

// React: ref composition / handing a parent an imperative handle (`useImperativeHandle`,
// forwarded/merged refs). Framework: `$expose` gives the parent an API, not the raw node —
// a stronger abstraction than exposing the DOM.
#[test]
fn imperative_handle_to_parent_via_expose() {
    let code = compile_component(
        "export default function Field() {\n  let el = $ref(null);\n  $expose({ focus: () => el.focus() });\n  return <input ref={el} />;\n}",
    );
    assert!(
        code.contains("Object.assign(this, ({ focus: () => el.value.focus() }));"),
        "$expose not emitted:\n{code}"
    );
}

// React: a dynamic-count collection of refs (`ref={el => map.set(id, el)}`) to focus /
// scroll / measure item N. Framework: each item is its own component that owns its ref
// and exposes what the parent needs — per-item lifecycle, no stale-entry map.
#[test]
fn dynamic_item_refs_via_per_item_component() {
    let src = "export default function Row({ label }) {\n  let el = $ref(null);\n  $expose({ scrollIntoView: () => el.scrollIntoView() });\n  return <li ref={el}>{label}</li>;\n}\n";
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("/app/components/Row.jsx"), src);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    let m = lower_module("/app/components/Row.jsx", &parsed.program, src, false).expect("module");
    let out = csr::emit_module(&m.components, &m.module_stmts, &m.module_exprs);
    assert!(out.errors.is_empty(), "{:?}\n{}", out.errors, out.code);
    // The row component owns its own ref and exposes a per-item API.
    assert!(out.code.contains("const el = signal(null);"), "{}", out.code);
    assert!(out.code.contains("el.value = el0;"), "{}", out.code);
    assert!(
        out.code.contains("Object.assign(this, ({ scrollIntoView: () => el.value.scrollIntoView() }));"),
        "{}",
        out.code
    );
}

// React: `useEffect(() => { const ro = new ResizeObserver(cb); ro.observe(ref.current);
// return () => ro.disconnect(); })`. Framework: `onResize(cb)` — the compiler wires a
// ResizeObserver on the host with automatic disconnect.
#[test]
fn measure_on_resize_via_hook() {
    let code = compile_component(
        "export default function Box() {\n  let w = $state(0);\n  onResize((entry) => w = entry.contentRect.width);\n  return <div>{w}</div>;\n}",
    );
    assert!(code.contains("new ResizeObserver("), "{code}");
    assert!(code.contains("__ro.observe(this);"), "observes the host:\n{code}");
    // The callback is `.value`-injected like any lifecycle callback.
    assert!(code.contains("w.value = entry.contentRect.width"), "{code}");
    // The disposer flows through the shared onMount-return path.
    assert!(code.contains("return () => __ro.disconnect();"), "{code}");
    assert!(code.contains("if (typeof __d === \"function\") this._cleanups.push(__d);"), "{code}");
}

// React: `useEffect` + `matchMedia` + manual initial call + listener removal.
// Framework: `onMediaQuery(query, cb)` — initial state delivered synchronously at
// mount, `change` listener removed on teardown.
#[test]
fn respond_to_media_query_via_hook() {
    let code = compile_page(
        "export default function Page() {\n  let compact = $state(false);\n  onMediaQuery(\"(max-width: 640px)\", (matches) => compact = matches);\n  return <main>{compact ? \"compact\" : \"wide\"}</main>;\n}",
    );
    assert!(code.contains("window.matchMedia((\"(max-width: 640px)\"));"), "{code}");
    // Initial state is delivered synchronously at mount…
    assert!(code.contains("__cb(__mql.matches, __mql);"), "{code}");
    // …then on every change, with the listener removed on teardown.
    assert!(code.contains("__mql.addEventListener(\"change\", __onchange);"), "{code}");
    assert!(
        code.contains("return () => __mql.removeEventListener(\"change\", __onchange);"),
        "{code}"
    );
    assert!(code.contains("__lifecycle.mounts.push(() => { const __cb = ("), "{code}");
}

// React: `useEffect` + IntersectionObserver on a ref to react to viewport visibility.
// Framework: `onVisibilityChange(cb)` — `cb(isIntersecting, entry)` on the host.
#[test]
fn react_to_viewport_visibility_via_hook() {
    let code = compile_component(
        "export default function Lazy() {\n  let seen = $state(false);\n  onVisibilityChange((visible) => { if (visible) seen = true; });\n  return <img data-seen={seen} />;\n}",
    );
    assert!(code.contains("new IntersectionObserver("), "{code}");
    assert!(code.contains("__io.observe(this);"), "observes the host:\n{code}");
    assert!(code.contains("__cb(__entry.isIntersecting, __entry);"), "{code}");
    assert!(code.contains("if (visible) seen.value = true;"), "{code}");
    assert!(code.contains("return () => __io.disconnect();"), "{code}");
}

// The one thing callback refs offer that the framework declines to mimic — a
// function receiving the node during render — is rejected with actionable guidance.
#[test]
fn function_valued_ref_rejected_with_guidance() {
    let session = ParseSession::new();
    let src = "export default function B() { return <input ref={(el) => el.focus()} />; }";
    let parsed = session.parse(Path::new("page.tsx"), src);
    let (at, hint) = function_ref_diagnostic(&parsed.program).expect("rejected");
    assert_eq!(&src[at as usize..at as usize + 3], "ref", "points at the offending attribute");
    assert!(hint.contains("$ref"), "{hint}");
    assert!(hint.contains("$effect") || hint.contains("onMount"), "{hint}");

    // A signal ref is accepted (no diagnostic).
    let ok = session.parse(
        Path::new("page.tsx"),
        "export default function B() { let r = $ref(null); return <input ref={r} />; }",
    );
    assert!(function_ref_diagnostic(&ok.program).is_none());
}
