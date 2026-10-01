//! Carry original-source slices through string-based codegen. An annotation
//! surrounds only text copied from an AST span; inserted helpers stay unmapped.
//! Annotations are removed before JavaScript leaves the compiler. This avoids
//! guessing provenance by searching the emitted code for matching source text.

use std::borrow::Cow;

/// A delimiter absent from the input, so source strings/comments cannot be
/// mistaken for compiler annotations when the output is decoded.
pub fn prefix(source: &str) -> String {
    let mut n = 0;
    loop {
        let prefix = format!("/*#__OTFW_MAP_{n}:");
        if !source.contains(&prefix) {
            return prefix;
        }
        n += 1;
    }
}

/// Copy an AST slice. Separate annotations per line preserve provenance when
/// an emitter adds indentation around multiline callbacks or statements.
pub fn copy(prefix: Option<&str>, source: &str, start: u32, end: u32) -> String {
    let slice = &source[start as usize..end as usize];
    let Some(prefix) = prefix else {
        return slice.to_string();
    };
    let mut out = String::new();
    let mut offset = start as usize;
    for line in slice.split_inclusive('\n') {
        out.push_str(&format!("{prefix}{offset}*/{line}{prefix}-*/"));
        offset += line.len();
    }
    out
}

/// Strip annotations for codegen decisions that inspect expression syntax.
/// Emission itself keeps the annotations until `finish`.
pub fn plain<'a>(prefix: Option<&str>, code: &'a str) -> Cow<'a, str> {
    let Some(prefix) = prefix else {
        return Cow::Borrowed(code);
    };
    let mut rest = code;
    let mut out = String::new();
    while let Some(at) = rest.find(prefix) {
        out.push_str(&rest[..at]);
        let tail = &rest[at + prefix.len()..];
        let end = tail.find("*/").expect("closed compiler annotation");
        rest = &tail[end + 2..];
    }
    out.push_str(rest);
    Cow::Owned(out)
}

pub struct MappedCode {
    pub code: String,
    /// ECMA-426 mappings, with one source (index 0) and no name entries.
    pub mappings: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Position {
    line: u32,
    column: u32,
    cr: bool,
}

fn advance(pos: &mut Position, ch: char) {
    if ch == '\n' && pos.cr {
        // CRLF is one line terminator.
    } else if ch == '\r' || ch == '\n' || ch == '\u{2028}' || ch == '\u{2029}' {
        pos.line += 1;
        pos.column = 0;
    } else {
        pos.column += ch.len_utf16() as u32;
    }
    pos.cr = ch == '\r';
}

/// Strip provenance annotations and encode their locations. The generated
/// positions count UTF-16 code units, not Rust UTF-8 bytes. End annotations
/// explicitly terminate mappings so generated helpers don't inherit them.
pub fn finish(annotated: &str, prefix: &str, source: &str) -> MappedCode {
    let mut originals = vec![
        Position {
            line: 0,
            column: 0,
            cr: false
        };
        source.len() + 1
    ];
    let mut pos = Position {
        line: 0,
        column: 0,
        cr: false,
    };
    for (offset, ch) in source.char_indices() {
        originals[offset] = pos;
        advance(&mut pos, ch);
    }
    originals[source.len()] = pos;

    let mut generated = Position {
        line: 0,
        column: 0,
        cr: false,
    };
    let mut lines: Vec<Vec<(u32, Option<Position>)>> = vec![Vec::new()];
    let mut cursor = None;
    let mut code = String::with_capacity(annotated.len());
    let mut rest = annotated;
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix(prefix) {
            let end = tail.find("*/").expect("closed compiler annotation");
            cursor = if &tail[..end] == "-" {
                None
            } else {
                Some(tail[..end].parse::<usize>().expect("source offset"))
            };
            add(&mut lines, generated, cursor.map(|at| originals[at]));
            rest = &tail[end + 2..];
            continue;
        }
        let ch = rest.chars().next().unwrap();
        if let Some(at) = cursor {
            // A backend can rewrite a copied slice further. Never claim an
            // exact mapping for text that no longer matches its source span.
            if source[at..].starts_with(ch) {
                add(&mut lines, generated, Some(originals[at]));
                cursor = Some(at + ch.len_utf8());
            } else {
                cursor = None;
                add(&mut lines, generated, None);
            }
        }
        code.push(ch);
        advance(&mut generated, ch);
        while lines.len() <= generated.line as usize {
            lines.push(Vec::new());
        }
        rest = &rest[ch.len_utf8()..];
    }
    let mut mappings = String::new();
    let mut previous_original = Position {
        line: 0,
        column: 0,
        cr: false,
    };
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            mappings.push(';');
        }
        let mut previous_column = 0;
        for (index, (column, original)) in line.iter().enumerate() {
            if index > 0 {
                mappings.push(',');
            }
            vlq(&mut mappings, *column as i64 - previous_column as i64);
            previous_column = *column;
            if let Some(original) = original {
                vlq(&mut mappings, 0); // source index delta: only source 0
                vlq(
                    &mut mappings,
                    original.line as i64 - previous_original.line as i64,
                );
                vlq(
                    &mut mappings,
                    original.column as i64 - previous_original.column as i64,
                );
                previous_original = *original;
            }
        }
    }
    MappedCode { code, mappings }
}

fn add(
    lines: &mut [Vec<(u32, Option<Position>)>],
    generated: Position,
    original: Option<Position>,
) {
    let line = &mut lines[generated.line as usize];
    if line
        .last()
        .is_some_and(|(column, _)| *column == generated.column)
    {
        *line.last_mut().unwrap() = (generated.column, original);
    } else {
        line.push((generated.column, original));
    }
}

fn vlq(out: &mut String, value: i64) {
    const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut value = (value.unsigned_abs() << 1) | u64::from(value < 0);
    loop {
        let mut digit = (value & 31) as usize;
        value >>= 5;
        if value != 0 {
            digit |= 32;
        }
        out.push(BASE64[digit] as char);
        if value == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copied_code_maps_columns_and_generated_helpers_are_unmapped() {
        let source = "\n  value + 1";
        let prefix = prefix(source);
        let code = format!("helper({}.value);", copy(Some(&prefix), source, 3, 8));
        let output = finish(&code, &prefix, source);
        assert_eq!(output.code, "helper(value.value);");
        // Unmapped boilerplate; column 7 maps to source line 1, column 2.
        assert!(output.mappings.starts_with("OACE"), "{}", output.mappings);
        assert!(
            output.mappings.ends_with(",C"),
            "terminates source region: {}",
            output.mappings
        );
    }

    #[test]
    fn unicode_and_multiline_spans_use_utf16_columns() {
        let source = "🔥x\nβ";
        let prefix = prefix(source);
        let copied = copy(Some(&prefix), source, 0, source.len() as u32);
        let output = finish(&format!("  {copied}"), &prefix, source);
        assert_eq!(output.code, format!("  {source}"));
        assert_eq!(output.mappings, "EAAA,EAAE,CAAC;AACH,C");
    }

    #[test]
    fn annotations_do_not_change_backend_output() {
        use crate::codegen::{csr, hydrate, ssg};
        use crate::lower::{lower_module, lower_module_with_source_map};
        use crate::parse::ParseSession;
        use std::path::Path;

        for source in [
            r#"export default function Home() {
                let n = $state(1);
                let doubled = $derived(n * 2);
                const click = () => { n++; };
                return <button onclick={click}>{doubled}</button>;
            }"#,
            r#"export default function Home() {
                let items = $state([{id: 1, label: "a"}]);
                return <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
            }"#,
            r#"export default function Home() {
                let visible = $state(true);
                const body = visible ? <b>Hello</b> : <i>Bye</i>;
                return <main>{body}</main>;
            }"#,
            r#"export default function Home() {
                let n = $state(1);
                $effect(() => { console.log(n); });
                onMount(() => { console.log("mounted"); });
                return <p>{n > 0 && <b>{n}</b>}</p>;
            }"#,
            "export default function Home() { const x = `first\nsecond`; return <p>{x}</p>; }",
        ] {
            let prefix = prefix(source);
            let session = ParseSession::new();
            let parsed = session.parse(Path::new("/app/page.jsx"), source);
            assert!(parsed.is_clean());
            for is_page in [true, false] {
                let lowered =
                    lower_module("/app/page.jsx", &parsed.program, source, is_page).unwrap();
                let mapped = lower_module_with_source_map(
                    "/app/page.jsx",
                    &parsed.program,
                    source,
                    is_page,
                    &prefix,
                )
                .unwrap();
                for (plain, annotated) in [
                    (
                        csr::emit_module(
                            &lowered.components,
                            &lowered.module_stmts,
                            &lowered.module_exprs,
                        )
                        .code,
                        csr::emit_module(
                            &mapped.components,
                            &mapped.module_stmts,
                            &mapped.module_exprs,
                        )
                        .code,
                    ),
                    (
                        hydrate::emit_module(
                            &lowered.components,
                            &lowered.module_stmts,
                            &lowered.module_exprs,
                        )
                        .code,
                        hydrate::emit_module(
                            &mapped.components,
                            &mapped.module_stmts,
                            &mapped.module_exprs,
                        )
                        .code,
                    ),
                    (
                        ssg::emit_module(
                            &lowered.components,
                            &lowered.module_stmts,
                            &lowered.module_exprs,
                        )
                        .code,
                        ssg::emit_module(
                            &mapped.components,
                            &mapped.module_stmts,
                            &mapped.module_exprs,
                        )
                        .code,
                    ),
                ] {
                    let output = finish(&annotated, &prefix, source);
                    assert_eq!(output.code, plain, "source: {source}");
                    let output_session = ParseSession::new();
                    let output_parsed = output_session.parse(Path::new("output.js"), &output.code);
                    assert!(output_parsed.is_clean(), "{:?}", output_parsed.errors);
                }
            }
        }
    }

    #[test]
    fn crlf_and_lone_cr_are_line_terminators() {
        let source = "a\r\nb\rc";
        let prefix = prefix(source);
        let copied = copy(Some(&prefix), source, 0, source.len() as u32);
        let output = finish(&copied, &prefix, source);
        assert_eq!(output.code, source);
        assert_eq!(output.mappings.split(';').count(), 3);
    }

    #[test]
    fn annotations_cannot_collide_with_original_source() {
        let source = "const example = '/*#__OTFW_MAP_0:123*/';";
        let prefix = prefix(source);
        let copied = copy(Some(&prefix), source, 0, source.len() as u32);
        assert_eq!(finish(&copied, &prefix, source).code, source);
    }
}
