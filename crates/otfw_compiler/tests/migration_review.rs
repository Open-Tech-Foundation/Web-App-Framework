//! Regression tests for the migration-review compiler bugs (C1–C7): patterns that
//! are valid JS/JSX but previously miscompiled to invalid or wrong output.
use std::path::Path;

use otfw_compiler::codegen::csr::emit_page;
use otfw_compiler::lower::{function_ref_diagnostic, lower_component};
use otfw_compiler::parse::ParseSession;

fn compile_page(source: &str) -> String {
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("page.tsx"), source);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    let lowered = lower_component("/app/page.tsx", &parsed.program, source, true).expect("page");
    let m = emit_page(&lowered);
    assert!(m.errors.is_empty(), "codegen errors: {:?}\n{}", m.errors, m.code);
    m.code
}

// C1: locals declared inside a `.map()` block-body callback must be preserved in
// the item builder so effect/style bindings referencing them resolve.
#[test]
fn c1_map_callback_locals_preserved() {
    let code = compile_page(
        "export function Board() {\n  let lists = $state([]);\n  return <div>{lists.map((list) => {\n    const listHeight = list.cards.length * 40;\n    return <section style={{ height: `${listHeight}px` }}>{list.title}</section>;\n  })}</div>;\n}",
    );
    assert!(code.contains("function Board_item0(list, _index)"), "{code}");
    assert!(
        code.contains("const listHeight = list.value.cards.length * 40;"),
        "map-local not preserved in item builder:\n{code}"
    );
    assert!(code.contains("${listHeight}px"), "{code}");
}

// C2/C3: `function (item, index)` map callbacks must lower to a keyed list with the
// params in scope (not hoist the JSX into a builder that can't see them).
#[test]
fn c2_function_expression_map_callback() {
    let code = compile_page(
        "export function Search() {\n  let searchResults = $state([]);\n  return <div>{searchResults.map(function (group, gi) {\n    return <div key={group.listId}>{group.name}{gi}</div>;\n  })}</div>;\n}",
    );
    assert!(code.contains("function Search_item0(group, gi)"), "not lowered to a list:\n{code}");
    assert!(code.contains("group.value.name"), "{code}");
    assert!(code.contains("bindList("), "{code}");
    // The index param is referenced directly, in scope.
    assert!(code.contains("() => (gi)"), "{code}");
}

// C4/C5: object-literal shorthand of a signal must expand to `{ key: key.value }`,
// not the invalid `{ key.value }`.
#[test]
fn c4_object_shorthand_expands() {
    let code = compile_page(
        "export function Login() {\n  let password = $state('');\n  const submit = () => { fetch('/x', { body: JSON.stringify({ password }) }); };\n  return <button onclick={submit}>Go</button>;\n}",
    );
    assert!(code.contains("{ password: password.value }"), "invalid shorthand codegen:\n{code}");
    assert!(!code.contains("{ password.value }"), "{code}");
}

fn diagnose(source: &str) -> Option<String> {
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("page.tsx"), source);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    // The diagnostic carries its source offset; these tests assert on the message.
    function_ref_diagnostic(&parsed.program).map(|(_, msg)| msg)
}

// C6: a function-valued (callback) ref is unsupported and must be rejected up front
// with actionable guidance — never miscompiled into the invalid `(fn).value = el`.
// (Every callback-ref use case is expressed via `$ref` + effects/lifecycle instead;
// see the `ref_patterns` suite.)
#[test]
fn c6_function_ref_is_rejected() {
    for src in [
        "export function Board() { return <input ref={(el) => el.focus()} />; }",
        "export function Board() { return <input ref={function (el) { el.focus(); }} />; }",
    ] {
        let hint = diagnose(src).expect("function ref should be rejected");
        assert!(hint.contains("function-valued `ref`"), "{hint}");
        assert!(hint.contains("$ref"), "{hint}");
    }
}

// A signal ref (`ref={someRef}`) is fine — no diagnostic — and still assigns the
// node to the ref's `.value`.
#[test]
fn c6_signal_ref_assigned() {
    let src = "export function Board() {\n  let box = $ref(null);\n  return <div ref={box}>x</div>;\n}";
    assert!(diagnose(src).is_none(), "signal ref must not be rejected");
    let code = compile_page(src);
    assert!(code.contains("box.value = el0;"), "signal ref codegen changed:\n{code}");
}

// C7: property/bracket assignment onto a `$state` object gets `.value` on the
// signal, producing valid `obj.value.key = …`.
#[test]
fn c7_member_assignment_on_state_object() {
    let code = compile_page(
        "export function Form() {\n  let formData = $state({ name: '' });\n  return <input oninput={(e) => { formData.name = e.target.value; }} />;\n}",
    );
    assert!(code.contains("formData.value.name = e.target.value"), "{code}");
}
