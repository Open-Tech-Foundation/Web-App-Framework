//! Recognizing compile-time-constant view subtrees, shared by the backends.
//!
//! A subtree with no holes, listeners, refs or components is fully determined at
//! compile time. That lets a backend emit it as one unit instead of once per node:
//! the hydrate backend claims its root and skips the walk (the server HTML already
//! holds the attributes, and claiming an element advances the cursor past its whole
//! subtree), which is what keeps a large static page from emitting a `cursor` and a
//! `claimElement`/`skipNode` per node purely to arrive back where it started.
//!
//! [`template_html`] takes the same idea to the **build** path: a static subtree can
//! be parsed once into a `<template>` and `cloneNode`d, instead of emitting a
//! `document.createElement` + `setAttribute` + `appendChild` per node. That is a
//! strictly larger claim, because `template.innerHTML` runs the subtree through the
//! HTML parser and the parser *restructures* markup `createElement` would have left
//! alone — so `template_html` only serializes a subtree it can prove round-trips.
//! See "Round-tripping the HTML parser" below.

use otfw_ir::view::{Prop, PropValue, ViewNode};

/// True when `node` and everything under it is compile-time constant: plain
/// elements and text carrying only static attributes — nothing that needs a JS
/// handle, an event listener, or a reactive binding.
pub fn is_static(node: &ViewNode) -> bool {
    match node {
        ViewNode::Text(_) => true,
        ViewNode::Element { props, children, .. } => {
            props.iter().all(is_static_prop) && children.iter().all(is_static)
        }
        // Everything else needs wiring: a component self-adopts and owns its own
        // structure, and holes, lists and `{children}` slots are dynamic by nature.
        _ => false,
    }
}

/// A prop that needs no work beyond what the server HTML already carries.
fn is_static_prop(prop: &Prop) -> bool {
    // A spread has an empty name and can carry anything; `ref` hands the node to
    // user code; `on*` needs a handler attached. An `on*` prop that is somehow
    // *static* is excluded too rather than special-cased — the backends disagree on
    // whether to serialize it, so it is not something to fold into a static unit.
    if prop.name.is_empty() || prop.name == "ref" || is_event_name(&prop.name) {
        return false;
    }
    matches!(prop.value, PropValue::Static(_) | PropValue::Boolean)
}

/// The `on*` test the backends use (`ssg::is_event`, `csr::is_event`).
fn is_event_name(name: &str) -> bool {
    name.len() > 2 && name.starts_with("on")
}

// ── Round-tripping the HTML parser ───────────────────────────────────────────
//
// `document.createElement(t)` + `appendChild` builds exactly the tree it is told to.
// `template.innerHTML = html` does not: it runs the HTML fragment parsing algorithm,
// which inserts, moves and drops nodes to satisfy content models. `<p><div/></p>`
// becomes `<p></p><div></div>`; `<table><tr>` grows a `<tbody>`; `<div>` inside
// `<table>` is foster-parented out in front of it. Cloning a template is only a
// legal rewrite of the build path where the parser is guaranteed to be a no-op.
//
// So this is a whitelist, not a best effort. The lists below enumerate the tags the
// spec's "in body" insertion mode handles *specially* (HTML §13.2.6.4.7); every other
// tag falls to "any other start tag", which inserts an ordinary element and is exactly
// what `createElement` does. A tag with special handling is either refused outright
// ([`NEVER`]) or admitted under a rule that rules out the restructuring case.
//
// Two things this analysis gets to assume, because the input is JSX rather than
// author-written HTML: every element is **explicitly closed** and **properly nested**.
// That is what takes the adoption agency algorithm off the table — misnested
// formatting elements (`<b><i></b></i>`) are the classic reparenting case and JSX
// cannot express one. Elements that close *themselves* on a nested start tag (`<p>`,
// `<li>`, `<a>`, `<button>`, headings) still can, so those get explicit rules.
//
// Two accepted differences, both of which move CSR *toward* the server-rendered tree
// rather than away from it — SSG serializes to HTML and hydration adopts what the
// parser produced, so this is the shape the hydrate path already assumes:
//
//  - adjacent `Text` siblings arrive as one merged text node, not two;
//  - an empty `Text` produces no node at all.
//
// Neither is observable through a `ref` (a subtree containing one is not static).

/// Void elements: serialized with no closing tag, and they may not carry children.
const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// Tags that can never appear anywhere in a cloned template, because the parser does
/// something to them that `createElement` does not — and no context makes it safe.
const NEVER: &[&str] = &[
    // Raw text and escapable raw text. Their content is not parsed as markup, so the
    // escaping a serializer must apply to every other element would show through
    // literally (`<style>a &gt; b</style>` renders the entity, not `>`).
    "script", "style", "textarea", "title", "xmp", "plaintext", "iframe", "noembed", "noframes",
    "noscript",
    // A nested `<template>`'s children land in its `.content` document fragment, not
    // in the tree the clone would return.
    "template",
    // Document structure: dropped, merged into the existing document, or relocated.
    "html", "head", "body", "base", "basefont", "bgsound", "link", "meta", "frame", "frameset",
    // Renamed by the tokenizer: `<image>` is inserted as `img`.
    "image",
    // Foreign content. The parser applies SVG/MathML namespace and attribute-case
    // fixups from a fixed table (`viewBox` survives, an unlisted camelCase attribute
    // does not) where the CSR path's `createElementNS` + `setAttribute` preserve what
    // was written. The two disagree, so SVG keeps the per-node build.
    "svg", "math",
    // Parser state we would have to model: the form element pointer (a nested `<form>`
    // is ignored) and `<select>`'s content model (non-option children are dropped).
    "form", "select", "optgroup", "option",
    // Ruby and `<nobr>` imply end tags on sibling start tags.
    "rb", "rp", "rt", "rtc", "nobr",
];

/// Start tags that close an open `<p>` (the "close a p element in button scope" list).
const CLOSES_P: &[&str] = &[
    "address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div", "dl",
    "dd", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
    "h6", "header", "hgroup", "hr", "li", "listing", "main", "menu", "nav", "ol", "p", "plaintext",
    "pre", "search", "section", "summary", "table", "ul", "xmp",
];

/// Elements that bound "button scope" — the parser stops looking for an open `<p>`
/// (or `<button>`) at one, so a `CLOSES_P` tag under one of these is harmless.
const SCOPE_BARRIER: &[&str] =
    &["applet", "button", "caption", "marquee", "object", "table", "td", "th", "template"];

/// Elements that push a *marker* onto the list of active formatting elements, which is
/// where the "a `<a>` start tag closes an open `<a>`" rule stops looking. Narrower than
/// [`SCOPE_BARRIER`]: a `<button>` or `<table>` does not bound the formatting list.
const FORMAT_MARKER: &[&str] = &["applet", "caption", "marquee", "object", "td", "th", "template"];

/// Elements that bound "list item scope": the `<li>`/`<dd>`/`<dt>` implied-end-tag
/// loop walks up the open elements and stops at any "special" element other than
/// `address`, `div` and `p` — so a nested list re-opens the nesting safely.
const ITEM_BARRIER: &[&str] = &[
    "blockquote", "dl", "fieldset", "figure", "menu", "ol", "section", "table", "td", "th", "ul",
];

/// The `<table>` content model, as the parser reconstructs it. A `<tr>` directly under
/// `<table>` gains an implied `<tbody>` and anything else is foster-parented out, so a
/// table is only cloneable when it is already written in this exact shape.
fn table_children(tag: &str) -> Option<&'static [&'static str]> {
    match tag {
        "table" => Some(&["caption", "colgroup", "thead", "tbody", "tfoot"]),
        "thead" | "tbody" | "tfoot" => Some(&["tr"]),
        "tr" => Some(&["td", "th"]),
        "colgroup" => Some(&["col"]),
        _ => None,
    }
}

/// Tags that are only legal inside a table, and are *ignored* anywhere else.
const TABLE_PART: &[&str] = &[
    "caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr",
];

fn is_heading(tag: &str) -> bool {
    matches!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
}

/// The parser drops one newline immediately after these start tags, so a serializer
/// has to write an extra one to preserve content that begins with a line break.
fn eats_leading_newline(tag: &str) -> bool {
    matches!(tag, "pre" | "listing")
}

/// Which enclosing elements are still open, for the rules that depend on it.
#[derive(Clone, Copy, Default)]
struct Ctx<'a> {
    parent: Option<&'a str>,
    /// A `<p>` is open in button scope: a `CLOSES_P` tag below would end it early.
    in_p: bool,
    /// An `<a>` / `<button>` is open: the parser closes it on a nested same-tag start.
    in_a: bool,
    in_button: bool,
    /// An `<li>` / `<dd>`|`<dt>` is open in list-item scope.
    in_li: bool,
    in_item: bool,
}

/// The HTML for a static subtree, when a `<template>` clone of it is identical to what
/// the per-node `createElement` build would have produced — `None` when the subtree is
/// dynamic, or when the parser might restructure it (see the module notes).
///
/// The root must be an element: a template clone hands back one node, and a text or
/// fragment root has nothing to hang the rest on.
pub fn template_html(node: &ViewNode) -> Option<String> {
    let ViewNode::Element { tag, .. } = node else {
        return None;
    };
    // A table *part* as the root parses under "in template" rules rather than the
    // "in body" ones this analysis reasons about — keep those on the build path.
    if TABLE_PART.contains(&tag.as_str()) {
        return None;
    }
    if !is_static(node) || !round_trips(node, Ctx::default()) {
        return None;
    }
    let mut out = String::new();
    write_html(node, &mut out);
    Some(out)
}

/// How many statements the per-node CSR build path would emit for `node` — the number
/// a template clone replaces with one. Backends use it to leave trivially small
/// subtrees alone, where a hoisted template const costs more than it saves.
pub fn build_stmt_count(node: &ViewNode) -> usize {
    match node {
        // One `createTextNode`, appended inline by `emit_append`.
        ViewNode::Text(_) => 1,
        ViewNode::Element { props, children, .. } => {
            // `const el = createElement(tag)` + one `setAttribute` per prop, then each
            // child's own statements plus the `appendChild` that is not inlined for it.
            1 + props.len()
                + children
                    .iter()
                    .map(|c| build_stmt_count(c) + usize::from(!matches!(c, ViewNode::Text(_))))
                    .sum::<usize>()
        }
        _ => 0,
    }
}

/// Whether `node` survives `template.innerHTML` unchanged, given what is open above it.
fn round_trips(node: &ViewNode, ctx: Ctx) -> bool {
    match node {
        // CR is normalized to LF by the input stream preprocessor, and NUL becomes
        // U+FFFD; a `createTextNode` keeps both. Nothing else in text is at risk once
        // `&`, `<` and `>` are escaped.
        ViewNode::Text(text) => !text.contains('\r') && !text.contains('\0'),
        ViewNode::Element { tag, props, children } => {
            let tag = tag.as_str();
            if !is_safe_name(tag) || NEVER.contains(&tag) {
                return false;
            }
            // A void element's children would be silently dropped by the parser.
            if VOID.contains(&tag) && !children.is_empty() {
                return false;
            }
            // Table parts are ignored outside a table, and a table's children are
            // rebuilt into the canonical shape — so both directions have to match.
            let parent_model = ctx.parent.and_then(table_children);
            match (TABLE_PART.contains(&tag), parent_model) {
                (true, Some(allowed)) if allowed.contains(&tag) => {}
                (false, None) => {}
                _ => return false,
            }
            // Inside a table's structure, only the elements above may appear —
            // stray text is foster-parented out in front of the table.
            let all_elements = children.iter().all(|c| matches!(c, ViewNode::Element { .. }));
            if table_children(tag).is_some() && !all_elements {
                return false;
            }
            // The self-closing cases: each of these ends an open element of its own
            // kind rather than nesting inside it.
            if (ctx.in_p && CLOSES_P.contains(&tag))
                || (ctx.in_a && tag == "a")
                || (ctx.in_button && tag == "button")
                || (ctx.in_li && tag == "li")
                || (ctx.in_item && matches!(tag, "dd" | "dt"))
                // `<h2>` directly inside `<h1>` pops the h1 (the rule fires only when
                // the heading is the *current* node, so any element between them is
                // enough to make it safe).
                || (is_heading(tag) && ctx.parent.is_some_and(is_heading))
            {
                return false;
            }
            if !props_round_trip(props) {
                return false;
            }
            let barrier = SCOPE_BARRIER.contains(&tag);
            let child_ctx = Ctx {
                parent: Some(tag),
                in_p: !barrier && (ctx.in_p || tag == "p"),
                in_a: !FORMAT_MARKER.contains(&tag) && (ctx.in_a || tag == "a"),
                // `<button>` bounds button scope, but it is also what the search is
                // *for* — the walk stops at the enclosing button by matching it — so it
                // does not shield a button nested inside it the way it shields a `<p>`.
                in_button: (!barrier || tag == "button") && (ctx.in_button || tag == "button"),
                in_li: !ITEM_BARRIER.contains(&tag) && (ctx.in_li || tag == "li"),
                in_item: !ITEM_BARRIER.contains(&tag) && (ctx.in_item || matches!(tag, "dd" | "dt")),
            };
            children.iter().all(|c| round_trips(c, child_ctx))
        }
        _ => false,
    }
}

/// Attributes survive the round trip when the parser reads back the same set: a name
/// it tokenizes identically, no duplicate the parser would discard, and no `is=`
/// (which upgrades a customized built-in at parse time — `setAttribute` does not).
fn props_round_trip(props: &[Prop]) -> bool {
    for (i, prop) in props.iter().enumerate() {
        if !is_safe_name(&prop.name) || prop.name.eq_ignore_ascii_case("is") {
            return false;
        }
        // The parser keeps the *first* of a repeated attribute; `setAttribute` keeps
        // the last. Rather than pick a winner, refuse the element.
        if props[..i].iter().any(|p| p.name.eq_ignore_ascii_case(&prop.name)) {
            return false;
        }
        match &prop.value {
            PropValue::Static(v) => {
                if v.contains('\r') || v.contains('\0') {
                    return false;
                }
            }
            PropValue::Boolean => {}
            _ => return false,
        }
    }
    true
}

/// A tag or attribute name the tokenizer reads back byte for byte. Deliberately
/// narrower than what HTML accepts — anything outside this is rare enough to leave
/// on the build path rather than reason about.
fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

/// Serialize a vetted subtree. Only ever called after [`round_trips`].
fn write_html(node: &ViewNode, out: &mut String) {
    match node {
        ViewNode::Text(text) => out.push_str(&escape_text(text)),
        ViewNode::Element { tag, props, children } => {
            out.push('<');
            out.push_str(tag);
            for prop in props {
                out.push(' ');
                out.push_str(&prop.name);
                out.push_str("=\"");
                if let PropValue::Static(v) = &prop.value {
                    out.push_str(&escape_attr(v));
                }
                out.push('"');
            }
            out.push('>');
            if VOID.contains(&tag.as_str()) {
                return;
            }
            // Give back the newline the parser is about to eat.
            if eats_leading_newline(tag) {
                out.push('\n');
            }
            for child in children {
                write_html(child, out);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
        // `round_trips` admits nothing else.
        _ => {}
    }
}

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use otfw_ir::identity::ExpressionId;

    fn el(tag: &str, props: Vec<Prop>, children: Vec<ViewNode>) -> ViewNode {
        ViewNode::Element { tag: tag.to_string(), props, children }
    }

    fn static_prop(name: &str) -> Prop {
        Prop { name: name.to_string(), value: PropValue::Static("v".into()) }
    }

    #[test]
    fn plain_nested_markup_is_static() {
        let tree = el(
            "section",
            vec![static_prop("class")],
            vec![
                el("h2", vec![], vec![ViewNode::Text("Title".into())]),
                el("p", vec![static_prop("id")], vec![ViewNode::Text("Body".into())]),
            ],
        );
        assert!(is_static(&tree));
    }

    #[test]
    fn text_alone_is_static() {
        assert!(is_static(&ViewNode::Text("x".into())));
    }

    #[test]
    fn a_hole_anywhere_below_makes_it_dynamic() {
        let tree = el(
            "div",
            vec![],
            vec![el("span", vec![], vec![ViewNode::Dynamic { expr: ExpressionId(0) }])],
        );
        assert!(!is_static(&tree), "a nested hole must disqualify the whole subtree");
    }

    #[test]
    fn a_component_is_never_static() {
        let tree = el(
            "div",
            vec![],
            vec![ViewNode::Component { name: "Card".into(), props: vec![], children: vec![] }],
        );
        assert!(!is_static(&tree), "a component self-adopts and owns its own structure");
    }

    #[test]
    fn slots_and_lists_are_never_static() {
        assert!(!is_static(&el("div", vec![], vec![ViewNode::Children])));
    }

    #[test]
    fn ref_event_and_spread_props_disqualify() {
        for prop in [
            Prop { name: "ref".into(), value: PropValue::Static("r".into()) },
            Prop { name: "onClick".into(), value: PropValue::Static("f".into()) },
            Prop { name: String::new(), value: PropValue::Static("o".into()) },
        ] {
            let name = prop.name.clone();
            assert!(
                !is_static(&el("div", vec![prop], vec![])),
                "prop {name:?} must disqualify the element"
            );
        }
    }

    #[test]
    fn a_dynamic_attribute_disqualifies() {
        let prop = Prop { name: "class".into(), value: PropValue::Dynamic(ExpressionId(0)) };
        assert!(!is_static(&el("div", vec![prop], vec![])));
    }

    // ── template_html ────────────────────────────────────────────────────────
    //
    // Every "refused" case below is markup the HTML parser rebuilds differently
    // from `createElement`; `packages/web-cli/tests/e2e/template-parity.mjs` proves
    // the accepted ones round-trip in a real engine.

    fn text(s: &str) -> ViewNode {
        ViewNode::Text(s.into())
    }

    fn attr(name: &str, value: &str) -> Prop {
        Prop { name: name.into(), value: PropValue::Static(value.into()) }
    }

    /// `<div>` wrapper so a subtree under test is never the template root itself.
    fn wrap(children: Vec<ViewNode>) -> ViewNode {
        el("div", vec![attr("class", "w")], children)
    }

    #[test]
    fn ordinary_markup_serializes() {
        let tree = el(
            "section",
            vec![attr("class", "hero")],
            vec![
                el("h1", vec![attr("id", "t")], vec![text("Hi")]),
                el("p", vec![], vec![text("a "), el("code", vec![], vec![text("b")])]),
                el("img", vec![attr("src", "/a.png")], vec![]),
            ],
        );
        assert_eq!(
            template_html(&tree).unwrap(),
            "<section class=\"hero\"><h1 id=\"t\">Hi</h1>\
             <p>a <code>b</code></p><img src=\"/a.png\"></section>"
        );
    }

    #[test]
    fn text_and_attribute_values_are_escaped() {
        let tree = el("p", vec![attr("title", "a\"b&c")], vec![text("1 < 2 & 3 > 0")]);
        assert_eq!(
            template_html(&tree).unwrap(),
            "<p title=\"a&quot;b&amp;c\">1 &lt; 2 &amp; 3 &gt; 0</p>"
        );
    }

    #[test]
    fn a_boolean_attribute_becomes_an_empty_value() {
        let tree = el("input", vec![Prop { name: "disabled".into(), value: PropValue::Boolean }], vec![]);
        assert_eq!(template_html(&tree).unwrap(), "<input disabled=\"\">");
    }

    #[test]
    fn pre_gets_back_the_newline_the_parser_eats() {
        let tree = el("pre", vec![], vec![el("code", vec![], vec![text("\nfn main() {}\n")])]);
        let html = template_html(&tree).unwrap();
        assert!(html.starts_with("<pre>\n<code>"), "got {html:?}");
    }

    #[test]
    fn a_dynamic_subtree_is_refused() {
        let tree = wrap(vec![ViewNode::Dynamic { expr: ExpressionId(0) }]);
        assert!(template_html(&tree).is_none());
    }

    #[test]
    fn a_text_or_fragment_root_is_refused() {
        assert!(template_html(&text("hi")).is_none(), "a clone must return one node");
        assert!(template_html(&ViewNode::Fragment(vec![text("hi")])).is_none());
    }

    #[test]
    fn a_block_element_inside_a_paragraph_is_refused() {
        // The classic case: `</p>` is implied before the `<div>`, hoisting it out.
        let tree = wrap(vec![el("p", vec![], vec![el("div", vec![], vec![text("x")])])]);
        assert!(template_html(&tree).is_none());
        // …but only while the `p` is really open — a button bounds the scope.
        let scoped =
            wrap(vec![el("p", vec![], vec![el("button", vec![], vec![el("div", vec![], vec![text("x")])])])]);
        assert!(template_html(&scoped).is_some(), "button scope ends the search for an open p");
    }

    #[test]
    fn inline_content_in_a_paragraph_is_fine() {
        let tree = wrap(vec![el(
            "p",
            vec![],
            vec![text("see "), el("a", vec![attr("href", "/x")], vec![text("here")]), text(".")],
        )]);
        assert!(template_html(&tree).is_some());
    }

    #[test]
    fn nested_self_closing_elements_are_refused() {
        for (outer, inner) in [("a", "a"), ("button", "button"), ("li", "li"), ("dd", "dd")] {
            let tree = wrap(vec![el(outer, vec![], vec![el(inner, vec![], vec![text("x")])])]);
            assert!(
                template_html(&tree).is_none(),
                "<{inner}> inside <{outer}> closes the outer one"
            );
        }
    }

    #[test]
    fn a_list_nested_through_its_container_is_fine() {
        // `<ul>` bounds list-item scope, so the inner `<li>` does not close the outer.
        let tree = wrap(vec![el(
            "ul",
            vec![],
            vec![el(
                "li",
                vec![],
                vec![text("a"), el("ul", vec![], vec![el("li", vec![], vec![text("b")])])],
            )],
        )]);
        assert!(template_html(&tree).is_some());
    }

    #[test]
    fn a_heading_directly_inside_a_heading_is_refused() {
        let nested = wrap(vec![el("h1", vec![], vec![el("h2", vec![], vec![text("x")])])]);
        assert!(template_html(&nested).is_none());
        // The rule only fires when the heading is the current node.
        let spaced =
            wrap(vec![el("h1", vec![], vec![el("span", vec![], vec![el("h2", vec![], vec![text("x")])])])]);
        assert!(template_html(&spaced).is_some());
    }

    #[test]
    fn a_canonical_table_is_accepted() {
        let tree = el(
            "table",
            vec![],
            vec![
                el("thead", vec![], vec![el("tr", vec![], vec![el("th", vec![], vec![text("a")])])]),
                el("tbody", vec![], vec![el("tr", vec![], vec![el("td", vec![], vec![text("1")])])]),
            ],
        );
        assert!(template_html(&tree).is_some());
    }

    #[test]
    fn a_table_the_parser_would_rebuild_is_refused() {
        // A bare `<tr>` under `<table>` gains an implied `<tbody>`.
        let implied_tbody =
            el("table", vec![], vec![el("tr", vec![], vec![el("td", vec![], vec![text("1")])])]);
        assert!(template_html(&implied_tbody).is_none());

        // Non-table content is foster-parented out in front of the table.
        let foster = el("table", vec![], vec![el("div", vec![], vec![text("x")])]);
        assert!(template_html(&foster).is_none());

        // Text inside the structure goes the same way.
        let stray = el("table", vec![], vec![text(" "), el("tbody", vec![], vec![])]);
        assert!(template_html(&stray).is_none());

        // A table part outside a table is dropped entirely.
        let orphan = wrap(vec![el("td", vec![], vec![text("x")])]);
        assert!(template_html(&orphan).is_none());

        // …and as the root it would parse under "in template" rules instead.
        let root = el("tr", vec![], vec![el("td", vec![], vec![text("x")])]);
        assert!(template_html(&root).is_none());
    }

    #[test]
    fn parser_special_tags_are_refused_anywhere() {
        for tag in ["script", "style", "textarea", "title", "template", "svg", "form", "select", "iframe"] {
            let tree = wrap(vec![el("span", vec![], vec![el(tag, vec![], vec![text("x")])])]);
            assert!(template_html(&tree).is_none(), "<{tag}> must keep the per-node build");
        }
    }

    #[test]
    fn attributes_the_parser_reads_back_differently_are_refused() {
        // `is=` upgrades a customized built-in at parse time; `setAttribute` does not.
        assert!(template_html(&el("div", vec![attr("is", "x"), attr("id", "y")], vec![text("t")])).is_none());
        // A repeated attribute: the parser keeps the first, `setAttribute` the last.
        assert!(template_html(&el("div", vec![attr("id", "a"), attr("ID", "b")], vec![text("t")])).is_none());
        // Names outside the safe charset stay on the build path.
        assert!(template_html(&el("div", vec![attr("da ta", "1"), attr("id", "y")], vec![text("t")])).is_none());
    }

    #[test]
    fn carriage_returns_are_refused() {
        // The input stream preprocessor normalizes CR to LF; `createTextNode` keeps it.
        assert!(template_html(&el("p", vec![attr("id", "x")], vec![text("a\r\nb")])).is_none());
        assert!(template_html(&el("p", vec![attr("title", "a\rb")], vec![text("x")])).is_none());
    }

    #[test]
    fn a_void_element_may_not_carry_children() {
        assert!(template_html(&el("br", vec![], vec![text("x")])).is_none());
    }

    #[test]
    fn build_stmt_count_matches_the_per_node_path() {
        // `const el = createElement("p")` + `setAttribute` + the inlined text append.
        assert_eq!(build_stmt_count(&el("p", vec![attr("id", "x")], vec![text("hi")])), 3);
        // A lone element is one statement; a wrapper adds its own `appendChild`.
        assert_eq!(build_stmt_count(&el("br", vec![], vec![])), 1);
        assert_eq!(build_stmt_count(&el("div", vec![], vec![el("br", vec![], vec![])])), 3);
    }
}
