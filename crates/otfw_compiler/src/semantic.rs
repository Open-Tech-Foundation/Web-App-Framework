//! Stage 2: Bind / Resolve — AST → Semantic Model.
//!
//! Builds the scope tree and resolves bindings (ARCHITECTURE.md §3, §5.1). This
//! is the foundation for *semantics over syntax* (principle 2): later stages
//! classify reactivity and props from resolved bindings, never from identifier
//! names or textual position.
//!
//! oxc's `SemanticBuilder` does the heavy lifting (scopes, symbols, references);
//! we wrap its output as the Semantic Model and grow framework-specific analysis
//! (reactive classification, client/server environment) on top in later passes.

use oxc::ast::ast::Program;
use oxc::diagnostics::OxcDiagnostic;
use oxc::semantic::Semantic;
use oxc::semantic::SemanticBuilder;

/// The resolved Semantic Model for one module: scopes, symbols, and references.
///
/// Borrows from the AST (and therefore the `ParseSession`'s allocator), so it
/// lives only as long as the parsed program it was built from.
pub struct Resolved<'a> {
    /// oxc's resolved view: scope tree, symbol table, reference graph.
    pub semantic: Semantic<'a>,
    /// Diagnostics raised during resolution (redeclarations, unresolved refs…).
    pub errors: Vec<OxcDiagnostic>,
}

impl<'a> Resolved<'a> {
    /// True when resolution produced no diagnostics.
    pub fn is_clean(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Run Stage 2 over a parsed program.
pub fn resolve<'a>(program: &'a Program<'a>) -> Resolved<'a> {
    let ret = SemanticBuilder::new().build(program);
    Resolved { semantic: ret.semantic, errors: ret.diagnostics.into() }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::parse::ParseSession;

    #[test]
    fn resolves_bindings_and_scopes() {
        let session = ParseSession::new();
        let source = "export function App() { const n = 1; return n; }";
        let parsed = session.parse(Path::new("App.tsx"), source);
        assert!(parsed.is_clean(), "parse errors: {:?}", parsed.errors);

        let resolved = resolve(&parsed.program);
        assert!(resolved.is_clean(), "resolve errors: {:?}", resolved.errors);
        // The module scope plus the function/body scopes exist.
        assert!(resolved.semantic.scoping().scopes_len() >= 2);
        // `n` is a resolved binding.
        assert!(resolved.semantic.scoping().symbol_names().any(|name| name == "n"));
    }
}
