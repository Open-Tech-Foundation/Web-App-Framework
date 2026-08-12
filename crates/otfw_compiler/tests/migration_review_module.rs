//! Regression tests for the migration-review module-level bugs (C8, C9).
use std::path::Path;

use otfw_compiler::codegen::csr;
use otfw_compiler::lower::{lower_module, no_component_diagnostic};
use otfw_compiler::parse::ParseSession;

fn compile_module(file: &str, source: &str) -> String {
    let session = ParseSession::new();
    let parsed = session.parse(Path::new(file), source);
    assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);
    let m = lower_module(file, &parsed.program, source, false).expect("module has components");
    let out = csr::emit_module(&m.components, &m.module_stmts, &m.module_exprs);
    assert!(out.errors.is_empty(), "codegen errors: {:?}\n{}", out.errors, out.code);
    out.code
}

// C8: a `.jsx` utility module can ship several named component exports; each must
// re-export its generated class under the source name so `import { Icon }` resolves
// and `<Icon/>` addresses it by `Icon.tag`.
#[test]
fn c8_named_component_exports_are_reexported() {
    let code = compile_module(
        "/app/components/BoardIcons.jsx",
        "export function MoreIcon() {\n  return <svg class=\"i\"><path d=\"M1\" /></svg>;\n}\nexport const TrashIcon = () => <svg class=\"i\"><path d=\"M3\" /></svg>;\n",
    );
    assert!(code.contains("export { MoreIconElement as MoreIcon };"), "{code}");
    assert!(code.contains("export { TrashIconElement as TrashIcon };"), "{code}");
}

// An internal (non-exported) sibling component gets no named re-export.
#[test]
fn c8_internal_component_not_reexported() {
    let code = compile_module(
        "/app/components/Widget.jsx",
        "function Row() { return <li>x</li>; }\nexport default function List() { return <ul><Row/></ul>; }\n",
    );
    assert!(!code.contains("as Row"), "internal component should not be re-exported:\n{code}");
    assert!(code.contains("export default ListElement;"), "{code}");
}

// C9: a component that builds JSX imperatively and returns a non-JSX value gets a
// clear, actionable diagnostic instead of the cryptic "no component found".
#[test]
fn c9_imperative_array_return_diagnoses() {
    let src = "export function SearchHighlight(props) {\n  const parts = [];\n  for (const seg of props.segments) {\n    parts.push(<span>{seg}</span>);\n  }\n  return parts;\n}\n";
    let session = ParseSession::new();
    let parsed = session.parse(Path::new("/app/components/SearchHighlight.jsx"), src);
    assert!(parsed.is_clean());
    // No component is recognized (the JSX is never returned as the view)...
    assert!(lower_module("/app/x.jsx", &parsed.program, src, false).is_none());
    // ...but the near-miss diagnostic explains why and points to `.map()`.
    let (at, hint) = no_component_diagnostic(&parsed.program).expect("a diagnostic");
    assert!((at as usize) < src.len(), "the diagnostic points into the source");
    assert!(hint.contains("SearchHighlight"), "{hint}");
    assert!(hint.contains(".map("), "{hint}");
}
