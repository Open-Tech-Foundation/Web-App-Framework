//! Compile diagnostics with a source location.
//!
//! A diagnostic that only says *what* went wrong ("parse error: Unexpected token")
//! leaves the developer to find *where*. Every failure the compiler reports carries a
//! byte offset into the module it was compiling, so this turns that into what an
//! editor and a browser overlay both need: a 1-based line and column, and a code frame
//! showing the offending line with a caret under the span.
//!
//! Two renderings, one source of truth:
//!   • [`Diag::text`] — for a terminal (`otfwc build`, and the toolchain's stderr).
//!   • [`Diag::json`] — for the `serve` protocol, so the dev server can put the file,
//!     the position and the frame into its error overlay as separate fields rather
//!     than re-parsing a prose string.

use std::fmt::Write as _;

/// How many source lines of context to show on each side of the offending line.
const CONTEXT_LINES: usize = 2;

pub struct Diag {
    /// The module id being compiled (as the toolchain passed it in).
    pub file: String,
    pub message: String,
    /// 1-based position of the offending span, when the failure has one.
    pub line: Option<usize>,
    pub column: Option<usize>,
    /// The rendered code frame (plain text, no colors), when there is a position.
    pub frame: Option<String>,
    /// Extra context about the position itself — used to say when it refers to
    /// generated code rather than the file the developer is editing.
    pub note: Option<String>,
}

impl Diag {
    /// A diagnostic with no known position.
    pub fn new(file: &str, message: impl Into<String>) -> Self {
        Self {
            file: file.to_string(),
            message: message.into(),
            line: None,
            column: None,
            frame: None,
            note: None,
        }
    }

    /// A diagnostic located at `offset` (a byte offset into `source`), underlining
    /// `len` bytes from there.
    pub fn at(file: &str, message: impl Into<String>, source: &str, offset: usize, len: usize) -> Self {
        let mut d = Self::new(file, message);
        let (line, column) = line_col(source, offset);
        d.frame = Some(code_frame(source, line, column, len.max(1)));
        d.line = Some(line);
        d.column = Some(column);
        d
    }

    /// Mark the position as pointing into generated code (an `.mdx` file is compiled
    /// through JSX, so a parse error's offset is a position in that generated JSX, not
    /// in the Markdown the developer wrote — saying so beats pointing at a wrong line).
    pub fn in_generated_source(mut self, from: &str) -> Self {
        if self.line.is_some() {
            self.note = Some(format!(
                "position refers to the JSX generated from {from}, not to the file itself",
            ));
        }
        self
    }

    /// `path:line:col message` plus the code frame — the shape editors and terminals
    /// already know how to read (esbuild / tsc / rustc all print this form).
    pub fn text(&self) -> String {
        let mut out = String::new();
        match (self.line, self.column) {
            (Some(l), Some(c)) => {
                let _ = writeln!(out, "{}:{}:{}: {}", self.file, l, c, self.message);
            }
            _ => {
                let _ = writeln!(out, "{}: {}", self.file, self.message);
            }
        }
        if let Some(note) = &self.note {
            let _ = writeln!(out, "note: {note}");
        }
        if let Some(frame) = &self.frame {
            let _ = write!(out, "\n{frame}");
        }
        out
    }

    /// The same diagnostic as a JSON object, for the `serve` reply frame.
    pub fn json(&self) -> String {
        let mut out = String::from("{");
        let _ = write!(out, "\"file\":{}", crate::json_str(&self.file));
        let _ = write!(out, ",\"message\":{}", crate::json_str(&self.message));
        if let Some(l) = self.line {
            let _ = write!(out, ",\"line\":{l}");
        }
        if let Some(c) = self.column {
            let _ = write!(out, ",\"column\":{c}");
        }
        if let Some(f) = &self.frame {
            let _ = write!(out, ",\"frame\":{}", crate::json_str(f));
        }
        if let Some(n) = &self.note {
            let _ = write!(out, ",\"note\":{}", crate::json_str(n));
        }
        out.push('}');
        out
    }
}

/// The 1-based line and column of a byte offset. Columns count characters, not bytes,
/// so a line with non-ASCII text before the span still points at the right place.
fn line_col(source: &str, offset: usize) -> (usize, usize) {
    let offset = offset.min(source.len());
    let before = &source[..offset];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let column = source[line_start..offset].chars().count() + 1;
    (line, column)
}

/// A code frame: the offending line with `len` characters underlined, plus a couple of
/// lines of context, in a numbered gutter.
///
/// ```text
///   3 |   const value = compute();
///   4 |   return <div>{value}
///     |               ^
///   5 | }
/// ```
fn code_frame(source: &str, line: usize, column: usize, len: usize) -> String {
    let lines: Vec<&str> = source.split('\n').collect();
    let first = line.saturating_sub(CONTEXT_LINES).max(1);
    let last = (line + CONTEXT_LINES).min(lines.len());
    let width = last.to_string().len();

    let mut out = String::new();
    for n in first..=last {
        let text = lines[n - 1].trim_end_matches('\r');
        let _ = writeln!(out, "{:>width$} | {}", n, text, width = width);
        if n != line {
            continue;
        }
        // Underline the span. A tab in the leading text advances the caret by one
        // column here, matching how the line above was written out verbatim.
        let lead: String = text
            .chars()
            .take(column.saturating_sub(1))
            .map(|c| if c == '\t' { '\t' } else { ' ' })
            .collect();
        let width_of_span = len.min(text.chars().count().saturating_sub(column - 1)).max(1);
        let _ = writeln!(
            out,
            "{:>width$} | {}{}",
            "",
            lead,
            "^".repeat(width_of_span),
            width = width
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locates_an_offset() {
        let src = "let a = 1;\nlet b = 2;\n";
        assert_eq!(line_col(src, 0), (1, 1));
        assert_eq!(line_col(src, 11), (2, 1));
        assert_eq!(line_col(src, 15), (2, 5));
    }

    #[test]
    fn counts_columns_in_characters() {
        let src = "const é = \"ü\";\n";
        let offset = src.find('\"').unwrap();
        let (line, column) = line_col(src, offset);
        assert_eq!(line, 1);
        assert_eq!(column, 11); // not the byte offset (13)
    }

    #[test]
    fn frames_the_offending_line_with_a_caret() {
        let src = "a\nb\nlet x = ;\nd\ne\nf\n";
        let frame = code_frame(src, 3, 9, 1);
        assert!(frame.contains("3 | let x = ;"), "{frame}");
        assert!(frame.contains("  |         ^"), "{frame}");
        // Two lines of context on each side, and nothing beyond.
        assert!(frame.contains("1 | a") && frame.contains("5 | e"), "{frame}");
        assert!(!frame.contains("6 | f"), "{frame}");
    }

    #[test]
    fn text_renders_path_line_column() {
        let d = Diag::at("app/page.jsx", "parse error: Unexpected token", "x\nlet y = ;\n", 10, 1);
        let text = d.text();
        assert!(text.starts_with("app/page.jsx:2:9: parse error: Unexpected token\n"), "{text}");
        assert!(text.contains("2 | let y = ;"), "{text}");
    }

    #[test]
    fn json_carries_the_fields_separately() {
        let d = Diag::at("app/page.jsx", "boom", "let y = ;\n", 8, 1);
        let json = d.json();
        assert!(json.contains("\"file\":\"app/page.jsx\""), "{json}");
        assert!(json.contains("\"line\":1"), "{json}");
        assert!(json.contains("\"column\":9"), "{json}");
        assert!(json.contains("\"message\":\"boom\""), "{json}");
        assert!(json.contains("\"frame\":\""), "{json}");
    }

    #[test]
    fn a_positionless_diagnostic_still_names_the_file() {
        let d = Diag::new("app/page.jsx", "no component found");
        assert_eq!(d.text(), "app/page.jsx: no component found\n");
        assert!(!d.json().contains("\"line\""));
    }
}
