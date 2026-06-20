//! Stage 1: Parse — source text → standard ESTree-compatible AST.
//!
//! Backed by oxc (ARCHITECTURE.md §3). This stage performs **no** transformation:
//! it produces a spec-compliant AST plus any syntax diagnostics. Everything
//! downstream (binding, lowering, codegen) reads from this AST.

use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::Program;
use oxc::diagnostics::OxcDiagnostic;
use oxc::parser::Parser;
use oxc::span::SourceType;

/// Owns the arena allocator that backs a single module's AST.
///
/// The parsed `Program` borrows from this allocator, so the session must outlive
/// every reference into the AST. Use **one session per module compile**: parse,
/// then run Stages 2–3 against the borrowed program while the session is alive.
pub struct ParseSession {
    allocator: Allocator,
}

impl Default for ParseSession {
    fn default() -> Self {
        Self::new()
    }
}

impl ParseSession {
    pub fn new() -> Self {
        Self { allocator: Allocator::default() }
    }

    /// Parse a module's `source`. The file `path` selects the dialect
    /// (`.tsx` / `.jsx` / `.ts` / `.js`); unknown extensions default to TSX,
    /// the framework's authoring format.
    ///
    /// Both the allocator (`&'a self`) and `source` must outlive the result,
    /// since the AST borrows from each.
    pub fn parse<'a>(&'a self, path: &Path, source: &'a str) -> Parsed<'a> {
        let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::tsx());
        let ret = Parser::new(&self.allocator, source, source_type).parse();
        Parsed {
            program: ret.program,
            errors: ret.diagnostics.into(),
            panicked: ret.panicked,
            source_type,
        }
    }
}

/// The output of Stage 1: the AST plus syntax diagnostics.
pub struct Parsed<'a> {
    /// The parsed program. Even when `errors` is non-empty oxc produces a
    /// best-effort tree, which keeps editor tooling usable on broken input.
    pub program: Program<'a>,
    /// Syntax diagnostics. Empty on a clean parse.
    pub errors: Vec<OxcDiagnostic>,
    /// Set when the parser bailed and the tree is unreliable.
    pub panicked: bool,
    /// The dialect the source was parsed as.
    pub source_type: SourceType,
}

impl Parsed<'_> {
    /// True when the parse produced a usable, error-free tree.
    pub fn is_clean(&self) -> bool {
        !self.panicked && self.errors.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_tsx() {
        let session = ParseSession::new();
        let source = "export function App() { return <div class=\"x\">hi</div>; }";
        let parsed = session.parse(Path::new("App.tsx"), source);
        assert!(parsed.is_clean(), "errors: {:?}", parsed.errors);
        assert!(!parsed.program.body.is_empty());
    }

    #[test]
    fn reports_syntax_errors() {
        let session = ParseSession::new();
        let parsed = session.parse(Path::new("Broken.tsx"), "export function (");
        assert!(!parsed.is_clean());
        assert!(!parsed.errors.is_empty());
    }

    #[test]
    fn unknown_extension_defaults_to_tsx() {
        let session = ParseSession::new();
        // JSX in a file with no recognized extension still parses as TSX.
        let parsed = session.parse(Path::new("noext"), "const x = <a/>;");
        assert!(parsed.is_clean(), "errors: {:?}", parsed.errors);
    }
}
