//! MDX front-end (ARCHITECTURE.md §3, §6): lower `.mdx`/`.md` to **JSX source** so
//! the existing parse → lower → CSR/SSG pipeline consumes it unchanged. We emit
//! literal HTML tag names (`<h1>`, `<p>`) and pass embedded components through by
//! identifier, so the output never contains member-expression components — which
//! otfwc rejects by design (SPEC §4.0.1) and which raw `@mdx-js` output would use.
//!
//! Markdown is parsed by the `markdown` crate (markdown-rs) to an mdast tree;
//! fenced code is highlighted at build time with `syntect`; YAML frontmatter
//! becomes `export const metadata = {…}` (consumed by the SSG `<head>` pass).

use std::sync::OnceLock;

use markdown::mdast::{AttributeContent, AttributeValue, Node};
use markdown::{to_mdast, MdxSignal, ParseOptions};
use syntect::highlighting::{Theme, ThemeSet};
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;

/// Lower MDX/Markdown `source` (from `file`, used for the component name) to a JSX
/// module string. The default export is a factory returning a fragment, named after
/// the file basename so an importable `guide.mdx` registers `web-guide` to match a
/// `<Guide/>` usage; module imports/exports are hoisted, and frontmatter becomes
/// `export const metadata`.
pub fn mdx_to_jsx(source: &str, file: &str) -> Result<String, String> {
    let mut options = ParseOptions::mdx();
    // Layer GFM tables/strikethrough/task-lists and frontmatter on top of MDX.
    options.constructs.frontmatter = true;
    options.constructs.gfm_table = true;
    options.constructs.gfm_strikethrough = true;
    options.constructs.gfm_task_list_item = true;
    options.constructs.gfm_autolink_literal = true;
    // markdown-rs only recognizes ESM (`import`/`export`) and validates expressions
    // when parse callbacks are present. We accept everything as-is — the emitted JSX
    // is validated downstream by oxc, so a JS parser here would be redundant work.
    options.mdx_esm_parse = Some(Box::new(|_| MdxSignal::Ok));
    options.mdx_expression_parse = Some(Box::new(|_, _| MdxSignal::Ok));

    let tree = to_mdast(source, &options).map_err(|m| m.to_string())?;

    let mut emit = Emit::default();
    let body = emit.node(&tree);

    let mut out = String::new();
    for esm in &emit.esm {
        out.push_str(esm.trim_end());
        out.push('\n');
    }
    if let Some(meta) = &emit.metadata {
        out.push_str(&format!("export const metadata = {meta};\n"));
    }
    out.push_str(&format!(
        "export default function {}(props) {{\n  return (<>",
        component_name(file)
    ));
    out.push_str(&body);
    out.push_str("</>);\n}\n");
    Ok(out)
}

#[derive(Default)]
struct Emit {
    /// Hoisted module-level `import`/`export` statements (from MDX ESM nodes).
    esm: Vec<String>,
    /// Object literal from frontmatter, if any.
    metadata: Option<String>,
}

impl Emit {
    fn nodes(&mut self, nodes: &[Node]) -> String {
        nodes.iter().map(|n| self.node(n)).collect()
    }

    fn node(&mut self, node: &Node) -> String {
        match node {
            Node::Root(n) => self.nodes(&n.children),
            Node::Heading(n) => {
                let inner = self.nodes(&n.children);
                let id = slugify(&node_text(node));
                let d = n.depth.clamp(1, 6);
                format!("<h{d} id=\"{id}\">{inner}</h{d}>")
            }
            Node::Paragraph(n) => format!("<p>{}</p>", self.nodes(&n.children)),
            Node::Text(n) => jsx_text(&n.value),
            Node::Strong(n) => format!("<strong>{}</strong>", self.nodes(&n.children)),
            Node::Emphasis(n) => format!("<em>{}</em>", self.nodes(&n.children)),
            Node::Delete(n) => format!("<del>{}</del>", self.nodes(&n.children)),
            Node::InlineCode(n) => format!("<code>{}</code>", jsx_text(&n.value)),
            Node::Break(_) => "<br/>".into(),
            Node::ThematicBreak(_) => "<hr/>".into(),
            Node::Blockquote(n) => format!("<blockquote>{}</blockquote>", self.nodes(&n.children)),
            Node::Link(n) => {
                let title = n
                    .title
                    .as_ref()
                    .map(|t| format!(" title=\"{}\"", attr_escape(t)))
                    .unwrap_or_default();
                format!(
                    "<a href=\"{}\"{title}>{}</a>",
                    attr_escape(&n.url),
                    self.nodes(&n.children)
                )
            }
            Node::Image(n) => {
                let title = n
                    .title
                    .as_ref()
                    .map(|t| format!(" title=\"{}\"", attr_escape(t)))
                    .unwrap_or_default();
                format!(
                    "<img src=\"{}\" alt=\"{}\"{title}/>",
                    attr_escape(&n.url),
                    attr_escape(&n.alt)
                )
            }
            Node::List(n) => {
                let tag = if n.ordered { "ol" } else { "ul" };
                let start = match n.start {
                    Some(s) if n.ordered && s != 1 => format!(" start={{{s}}}"),
                    _ => String::new(),
                };
                format!("<{tag}{start}>{}</{tag}>", self.nodes(&n.children))
            }
            Node::ListItem(n) => {
                let checkbox = match n.checked {
                    Some(c) => format!(
                        "<input type=\"checkbox\" disabled{} /> ",
                        if c { " checked" } else { "" }
                    ),
                    None => String::new(),
                };
                format!("<li>{checkbox}{}</li>", self.nodes(&n.children))
            }
            Node::Code(n) => emit_code(n.value.as_str(), n.lang.as_deref().unwrap_or("")),
            Node::Table(n) => self.emit_table(n),
            Node::TableRow(n) => format!("<tr>{}</tr>", self.nodes(&n.children)),
            Node::TableCell(n) => format!("<td>{}</td>", self.nodes(&n.children)),
            Node::MdxJsxFlowElement(n) => self.jsx_element(&n.name, &n.attributes, &n.children),
            Node::MdxJsxTextElement(n) => self.jsx_element(&n.name, &n.attributes, &n.children),
            Node::MdxFlowExpression(n) => expression(&n.value),
            Node::MdxTextExpression(n) => expression(&n.value),
            Node::MdxjsEsm(n) => {
                self.esm.push(n.value.clone());
                String::new()
            }
            Node::Yaml(n) => {
                self.metadata.get_or_insert_with(|| frontmatter_object(&n.value));
                String::new()
            }
            Node::Html(n) => format!("<RawHtml html={{{}}} />", js_string(&n.value)),
            // Definitions/references/math: no inline output in v1 (rare in docs).
            _ => String::new(),
        }
    }

    /// GFM table: first row is the header (`<th>` cells), the rest are `<td>`.
    fn emit_table(&mut self, table: &markdown::mdast::Table) -> String {
        let mut head = String::new();
        let mut body = String::new();
        for (i, row) in table.children.iter().enumerate() {
            let Node::TableRow(r) = row else { continue };
            if i == 0 {
                let cells: String = r
                    .children
                    .iter()
                    .map(|c| match c {
                        Node::TableCell(cell) => format!("<th>{}</th>", self.nodes(&cell.children)),
                        _ => String::new(),
                    })
                    .collect();
                head = format!("<thead><tr>{cells}</tr></thead>");
            } else {
                body.push_str(&self.node(row));
            }
        }
        format!("<table>{head}<tbody>{body}</tbody></table>")
    }

    /// Re-serialize an MDX JSX element (or a fragment when `name` is `None`).
    fn jsx_element(
        &mut self,
        name: &Option<String>,
        attrs: &[AttributeContent],
        children: &[Node],
    ) -> String {
        let inner = self.nodes(children);
        match name {
            None => format!("<>{inner}</>"),
            Some(n) => {
                let attrs = emit_attrs(attrs);
                if children.is_empty() {
                    format!("<{n}{attrs} />")
                } else {
                    format!("<{n}{attrs}>{inner}</{n}>")
                }
            }
        }
    }
}

/// Re-serialize MDX JSX attributes: `name`, `name="literal"`, `name={expr}`, `{...spread}`.
fn emit_attrs(attrs: &[AttributeContent]) -> String {
    let mut s = String::new();
    for a in attrs {
        match a {
            AttributeContent::Property(p) => match &p.value {
                None => s.push_str(&format!(" {}", p.name)),
                Some(AttributeValue::Literal(v)) => {
                    s.push_str(&format!(" {}=\"{}\"", p.name, attr_escape(v)))
                }
                Some(AttributeValue::Expression(e)) => {
                    s.push_str(&format!(" {}={{{}}}", p.name, e.value))
                }
            },
            // Spread: `e.value` already includes the leading `...`.
            AttributeContent::Expression(e) => s.push_str(&format!(" {{{}}}", e.value)),
        }
    }
    s
}

/// An MDX expression `{…}`. Comment-only expressions (`{/* … */}`) are dropped.
fn expression(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || (trimmed.starts_with("/*") && trimmed.ends_with("*/")) {
        return String::new();
    }
    format!("{{{value}}}")
}

/// Build-time syntax highlighting → a single raw-HTML node (`<RawHtml>`). On any
/// failure (unknown grammar issue) falls back to a plain escaped `<pre>`.
fn emit_code(code: &str, lang: &str) -> String {
    static SYNTAXES: OnceLock<SyntaxSet> = OnceLock::new();
    static THEME: OnceLock<Theme> = OnceLock::new();
    let ss = SYNTAXES.get_or_init(SyntaxSet::load_defaults_newlines);
    let theme = THEME.get_or_init(|| {
        let mut themes = ThemeSet::load_defaults();
        themes
            .themes
            .remove("base16-ocean.dark")
            .expect("syntect default theme")
    });

    let syntax = ss
        .find_syntax_by_token(lang)
        .unwrap_or_else(|| ss.find_syntax_plain_text());
    let html = highlighted_html_for_string(code, ss, syntax, theme)
        .unwrap_or_else(|_| format!("<pre><code>{}</code></pre>", html_escape(code)));
    format!("<RawHtml html={{{}}} />", js_string(&html))
}

/// Concatenated text of a node's descendants (for heading ids).
fn node_text(node: &Node) -> String {
    match node {
        Node::Text(t) => t.value.clone(),
        Node::InlineCode(c) => c.value.clone(),
        _ => node
            .children()
            .map(|ch| ch.iter().map(node_text).collect())
            .unwrap_or_default(),
    }
}

/// PascalCase component name from a file path basename (`a/guide.mdx` → `Guide`,
/// `my-doc.md` → `MyDoc`). Falls back to `MDXContent` if nothing usable remains.
fn component_name(file: &str) -> String {
    let stem = file
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file)
        .split('.')
        .next()
        .unwrap_or("");
    let mut out = String::new();
    let mut upper = true;
    for c in stem.chars() {
        if c.is_alphanumeric() {
            if upper {
                out.extend(c.to_uppercase());
            } else {
                out.push(c);
            }
            upper = false;
        } else {
            upper = true;
        }
    }
    if out.is_empty() || !out.chars().next().unwrap().is_alphabetic() {
        "MDXContent".to_string()
    } else {
        out
    }
}

/// GitHub-style heading slug: lowercased, non-alphanumerics collapsed to `-`.
fn slugify(text: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

/// Minimal frontmatter → JS object literal: flat `key: value` scalar lines. Values
/// are emitted as strings (booleans/numbers passed through). Good enough for docs
/// metadata (title/description/…); richer YAML is a follow-up.
fn frontmatter_object(yaml: &str) -> String {
    let mut fields = Vec::new();
    for line in yaml.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        let rendered = if matches!(value, "true" | "false") || value.parse::<f64>().is_ok() {
            value.to_string()
        } else {
            js_string(value)
        };
        fields.push(format!("{}: {rendered}", js_string(key)));
    }
    format!("{{ {} }}", fields.join(", "))
}

/// Escape markdown text for use as JSX **text** (entity-encode JSX specials so it
/// stays a static text node — `{`/`}` would otherwise open an expression).
fn jsx_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '{' => out.push_str("&#123;"),
            '}' => out.push_str("&#125;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escape a double-quoted HTML attribute value.
fn attr_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

/// Plain HTML text escape (fallback code rendering).
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// A JS double-quoted string literal for an arbitrary value.
fn js_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_gets_a_slug_id() {
        let out = mdx_to_jsx("# Hello World", "doc.mdx").unwrap();
        assert!(out.contains("<h1 id=\"hello-world\">Hello World</h1>"), "{out}");
    }

    #[test]
    fn paragraph_and_inline_marks() {
        let out = mdx_to_jsx("a **b** and *c*", "doc.mdx").unwrap();
        assert!(out.contains("<p>"));
        assert!(out.contains("<strong>b</strong>"));
        assert!(out.contains("<em>c</em>"));
    }

    #[test]
    fn fenced_code_is_highlighted_into_rawhtml() {
        let out = mdx_to_jsx("```js\nconst x = 1;\n```", "doc.mdx").unwrap();
        assert!(out.contains("<RawHtml html={\""), "{out}");
        assert!(out.contains("<pre"), "{out}");
    }

    #[test]
    fn components_and_expressions_pass_through() {
        let out = mdx_to_jsx("text {2 + 2}\n\n<Counter start={3} />", "doc.mdx").unwrap();
        assert!(out.contains("{2 + 2}"), "{out}");
        assert!(out.contains("<Counter start={3} />"), "{out}");
    }

    #[test]
    fn esm_is_hoisted_above_the_factory() {
        let out = mdx_to_jsx("import Counter from \"./Counter.jsx\";\n\n# Title", "doc.mdx").unwrap();
        let import_at = out.find("import Counter").unwrap();
        let factory_at = out.find("export default function").unwrap();
        assert!(import_at < factory_at, "{out}");
    }

    #[test]
    fn frontmatter_becomes_metadata() {
        let out = mdx_to_jsx("---\ntitle: Intro\ndescription: A page\n---\n\n# Hi", "doc.mdx").unwrap();
        assert!(out.contains("export const metadata = {"), "{out}");
        assert!(out.contains("\"title\": \"Intro\""), "{out}");
        assert!(out.contains("\"description\": \"A page\""), "{out}");
    }

    #[test]
    fn output_has_no_member_expression_components() {
        // Plain markdown must never emit `<_components.x>` (would violate SPEC §4.0.1).
        let out = mdx_to_jsx("# H\n\npara\n\n- a\n- b\n", "doc.mdx").unwrap();
        assert!(!out.contains("_components."), "{out}");
        assert!(!out.contains(".h1"), "{out}");
    }

    #[test]
    fn default_export_is_named_after_the_file() {
        // So an importable `guide.mdx` registers `web-guide` for a `<Guide/>` usage.
        let out = mdx_to_jsx("# Hi", "app/docs/guide.mdx").unwrap();
        assert!(out.contains("export default function Guide(props)"), "{out}");
        let dashed = mdx_to_jsx("# Hi", "my-doc.md").unwrap();
        assert!(dashed.contains("export default function MyDoc(props)"), "{dashed}");
    }

    #[test]
    fn jsx_specials_in_text_are_escaped() {
        let out = mdx_to_jsx("use a `{}` brace and a < sign", "doc.mdx").unwrap();
        assert!(!out.contains(" < sign"), "{out}");
        assert!(out.contains("&lt;"), "{out}");
    }
}
