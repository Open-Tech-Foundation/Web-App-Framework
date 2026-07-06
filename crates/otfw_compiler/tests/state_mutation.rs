//! `$state` holds a signal whose value is *replaced*, never mutated: reactivity
//! fires on `signal.value = …`, not on mutating the object the value points at.
//! Writing `list.push(x)`, `list[0] = x`, `obj.a.b = x`, `obj.n++`, etc. therefore
//! updates the data but notifies no effect — the change is silently lost. These
//! tests pin the compile-time diagnostic that rejects such mutations with the
//! immutable-update / `reactive()` fix (SPEC §3.4), and confirm the legal patterns
//! (immutable reassignment, primitive updates, read methods, non-`$state` locals,
//! `$ref` DOM writes) still pass clean.
use std::path::Path;

use otfw_compiler::lower::state_mutation_diagnostic;
use otfw_compiler::parse::ParseSession;

/// The diagnostic message for `source`, or `None` when the module is clean.
fn diagnose(source: &str) -> Option<String> {
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("C.tsx"), source);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    state_mutation_diagnostic(&parsed.program, source)
}

/// Assert `source` is rejected and the guidance names the immutable escape hatches.
fn assert_rejected(source: &str) -> String {
    let msg = diagnose(source).unwrap_or_else(|| panic!("expected rejection for:\n{source}"));
    assert!(msg.contains("$state"), "message names $state:\n{msg}");
    assert!(msg.contains("reactive()"), "message points to reactive():\n{msg}");
    msg
}

/// Assert `source` compiles clean (no mutation diagnostic).
fn assert_clean(source: &str) {
    if let Some(msg) = diagnose(source) {
        panic!("expected clean, got diagnostic:\n{msg}\n\nfor source:\n{source}");
    }
}

// ── Rejected: in-place mutation of a `$state` value ──────────────────────────

// The original report: `.push()` on a `$state` array is a silent no-op.
#[test]
fn rejects_array_push() {
    let msg = assert_rejected(
        "export default function List() {\n\
         \x20 const myList = $state([]);\n\
         \x20 const add = () => { myList.push(\"Random\"); };\n\
         \x20 return <button onClick={add}>New</button>;\n\
         }",
    );
    assert!(msg.contains("myList.push"), "snippet is quoted back:\n{msg}");
}

#[test]
fn rejects_all_array_mutators() {
    for m in ["pop()", "shift()", "unshift(1)", "splice(0, 1)", "reverse()", "sort()", "fill(0)"] {
        assert_rejected(&format!(
            "export default function C() {{\n\
             \x20 const xs = $state([1, 2, 3]);\n\
             \x20 const go = () => {{ xs.{m}; }};\n\
             \x20 return <button onClick={{go}}>x</button>;\n\
             }}"
        ));
    }
}

#[test]
fn rejects_index_assignment() {
    assert_rejected(
        "export default function C() {\n\
         \x20 const xs = $state([1]);\n\
         \x20 const go = () => { xs[0] = 9; };\n\
         \x20 return <button onClick={go}>x</button>;\n\
         }",
    );
}

#[test]
fn rejects_length_assignment() {
    assert_rejected(
        "export default function C() {\n\
         \x20 const xs = $state([1, 2]);\n\
         \x20 const clear = () => { xs.length = 0; };\n\
         \x20 return <button onClick={clear}>x</button>;\n\
         }",
    );
}

#[test]
fn rejects_object_property_write() {
    assert_rejected(
        "export default function C() {\n\
         \x20 const user = $state({ name: \"a\", meta: { age: 1 } });\n\
         \x20 const go = () => { user.meta.age = 2; };\n\
         \x20 return <button onClick={go}>x</button>;\n\
         }",
    );
}

#[test]
fn rejects_member_increment() {
    assert_rejected(
        "export default function C() {\n\
         \x20 const s = $state({ n: 0 });\n\
         \x20 const go = () => { s.n++; };\n\
         \x20 return <button onClick={go}>x</button>;\n\
         }",
    );
}

// ── Clean: the legal ways to update state ────────────────────────────────────

// The prescribed fix — reassigning the signal with a new array — is legal.
#[test]
fn allows_immutable_reassignment() {
    assert_clean(
        "export default function List() {\n\
         \x20 let myList = $state([]);\n\
         \x20 const add = () => { myList = [...myList, \"Random\"]; };\n\
         \x20 return <button onClick={add}>New</button>;\n\
         }",
    );
}

// Primitive updates are `.value` reassignments, not mutations — always legal.
#[test]
fn allows_primitive_reassignment_and_update() {
    assert_clean(
        "export default function C() {\n\
         \x20 let count = $state(0);\n\
         \x20 const inc = () => { count++; count = count + 1; };\n\
         \x20 return <button onClick={inc}>{count}</button>;\n\
         }",
    );
}

// Read methods are how JSX and `_mapped()` consume the list — must stay legal.
#[test]
fn allows_read_methods() {
    assert_clean(
        "export default function List() {\n\
         \x20 const items = $state([1, 2, 3]);\n\
         \x20 return <ul>{items.filter((i) => i > 1).map((i) => <li>{i}</li>)}</ul>;\n\
         }",
    );
}

// A plain local (not `$state`) may be mutated freely — e.g. building an array.
#[test]
fn allows_mutation_of_non_state_local() {
    assert_clean(
        "export default function C() {\n\
         \x20 const build = () => { const parts = []; parts.push(1); return parts; };\n\
         \x20 return <button onClick={build}>x</button>;\n\
         }",
    );
}

// A local that shadows a `$state` name is a different symbol — not flagged.
#[test]
fn allows_shadowed_local_mutation() {
    assert_clean(
        "export default function C() {\n\
         \x20 const xs = $state([1]);\n\
         \x20 const go = () => { const xs = []; xs.push(2); };\n\
         \x20 return <button onClick={go}>{xs.length}</button>;\n\
         }",
    );
}

// `$ref` holds a DOM node; imperative DOM writes on it are legitimate, not state
// mutations, so they must not be flagged.
#[test]
fn allows_ref_dom_write() {
    assert_clean(
        "export default function C() {\n\
         \x20 let box = $ref(null);\n\
         \x20 onMount(() => { box.scrollTop = 0; });\n\
         \x20 return <div ref={box} />;\n\
         }",
    );
}

// A module with no `$state` at all is trivially clean (fast path).
#[test]
fn allows_module_without_state() {
    assert_clean("export default function C() { return <div>hi</div>; }");
}
