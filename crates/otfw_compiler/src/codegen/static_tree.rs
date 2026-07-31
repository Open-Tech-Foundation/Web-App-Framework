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
pub fn eats_leading_newline(tag: &str) -> bool {
    matches!(tag, "pre" | "listing")
}

/// Elements whose content the tokenizer does **not** parse as markup: raw text
/// (`script`, `style`, …) and escapable raw text (`textarea`, `title`). A comment
/// written inside one comes back as literal characters, so the hydration text-hole
/// markers can't go there and the SSG backend has to emit the content bare
/// (`ssg::raw_text_mode`).
pub fn is_raw_text(tag: &str) -> bool {
    matches!(
        tag,
        "script" | "style" | "textarea" | "title" | "xmp" | "iframe" | "noembed" | "noframes"
            | "noscript" | "plaintext"
    )
}

/// Raw text (`script`, `style`, …) vs *escapable* raw text (`textarea`, `title`).
/// The escapable kind still resolves character references, so its content is escaped
/// like any other text; the raw kind is emitted verbatim (escaping would show through
/// literally — `<style>a &gt; b</style>` renders the entity, not `>`).
pub fn is_escapable_raw_text(tag: &str) -> bool {
    matches!(tag, "textarea" | "title")
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
    /// A `<form>` is open: the form element pointer makes the parser ignore a nested one.
    in_form: bool,
    /// Inside SVG/MathML, where the HTML insertion modes (and every rule above) are
    /// replaced by the foreign-content ones — nesting is taken at face value there.
    foreign: bool,
}

impl<'a> Ctx<'a> {
    /// Would *unknown* element content here risk closing something the walk assumes is
    /// still open?
    ///
    /// Only inside a `<p>`. The other implied-end-tag rules fire on a specific start tag
    /// — a second `<a>` closes an `<a>`, a second `<button>` a `<button>`, a second
    /// `<li>` an `<li>` — and content shaped like that is invalid markup nobody writes,
    /// whereas `<p>` is closed by *any* of the many block-level tags in [`CLOSES_P`], so
    /// content that merely starts with a `<div>` is enough. Treating `<a>`/`<li>` as
    /// fragile too would refuse `<a>{children}</a>` — the `Link` component, and with it
    /// every nav on every page.
    fn fragile(&self) -> bool {
        self.in_p
    }

    /// Is the insertion point inside a table's own structure, where anything that is
    /// not a table part gets foster-parented out in front of the table?
    fn in_table_structure(&self) -> bool {
        self.parent.is_some_and(|p| table_children(p).is_some())
    }
}

/// What question the walk is answering.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    /// May this subtree be serialized once and `cloneNode`d in place of the per-node
    /// `createElement` build? Static input only, and byte-identical or nothing.
    Clone,
    /// Do the SSG bytes for this view re-parse into the tree the hydrate claim walk
    /// was generated against? Dynamic content is allowed — the question is only
    /// whether the parser *restructures* what the server wrote.
    Adopt,
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
    if !is_static(node) || walk(node, Ctx::default(), Mode::Clone).is_err() {
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

/// Why the SSG bytes for `view` would not re-parse into the tree a hydrate claim walk
/// is generated against — `None` when the parser leaves the markup alone and the walk
/// can safely adopt it.
///
/// This is [`template_html`]'s analysis asked in the other direction. There, the input
/// is static and the bar is a byte-identical clone; here the input is a whole view —
/// holes, lists, components — and the bar is *structural*: the parser must not insert,
/// move or drop a node relative to what the SSG backend serialized, because the claim
/// walk addresses nodes positionally. Content the walk cannot see through (a component's
/// own view, a `{children}` slot) is treated as arbitrary element content: fine in an
/// ordinary parent, refused where an implied end tag or foster parenting could fire.
pub fn reparse_hazard(view: &ViewNode) -> Option<String> {
    walk(view, Ctx::default(), Mode::Adopt).err()
}

/// The shared parser model. `Mode::Clone` answers "byte-identical after a re-parse?"
/// for a static subtree; `Mode::Adopt` answers "same tree shape?" for a whole view.
fn walk(node: &ViewNode, ctx: Ctx, mode: Mode) -> Result<(), String> {
    match node {
        // CR is normalized to LF by the input stream preprocessor, and NUL becomes
        // U+FFFD; a `createTextNode` keeps both. Nothing else in text is at risk once
        // `&`, `<` and `>` are escaped.
        ViewNode::Text(text) => {
            if mode == Mode::Clone && (text.contains('\r') || text.contains('\0')) {
                return Err("text carrying a carriage return or NUL".into());
            }
            if ctx.in_table_structure() && !text.trim().is_empty() {
                return Err(table_text_err(ctx));
            }
            Ok(())
        }
        ViewNode::Element { tag, props, children } => element(tag, props, children, ctx, mode),
        // Below here the node is dynamic: only the adopt walk has anything to say.
        _ if mode == Mode::Clone => Err("dynamic content".into()),
        // A text hole renders text — safe anywhere the parser accepts text.
        ViewNode::Dynamic { .. } => {
            if ctx.in_table_structure() {
                return Err(table_text_err(ctx));
            }
            Ok(())
        }
        // Regions the server brackets with marker comments (`<!--[-->…<!--]-->`): inside a
        // table the parser relocates rows into an implied section but leaves the comments
        // where they were, so the markers no longer bracket the content they opened.
        // A region the server brackets with marker comments (`<!--[-->…<!--]-->`). The
        // markers themselves are safe wherever a comment is — what matters is what the
        // region renders, so the item / branch views are walked in this position.
        ViewNode::List { item, .. } => walk(item, ctx, mode),
        ViewNode::DynamicNode { branches, .. } => {
            branches.iter().try_for_each(|b| walk(b, ctx, mode))
        }
        // Content this view cannot see: a component's own markup, or whatever the parent
        // slotted in. Either can start with a block element, which is exactly what closes
        // an open `<p>`/`<a>`/`<button>`/`<li>` early (the island-in-a-paragraph case).
        ViewNode::Component { .. } | ViewNode::Children => {
            // A component's host is an unknown tag, which a table's insertion modes
            // foster-parent out in front of the table. A `{children}` slot contributes no
            // element of its own — only its markers, which a table keeps where they were
            // — so the parent's content is left to the parent's own walk.
            if ctx.in_table_structure() && matches!(node, ViewNode::Component { .. }) {
                return Err(table_text_err(ctx));
            }
            if ctx.fragile() {
                return Err(format!(
                    "{} inside <p>: content the parser hoists out would close the <p> early",
                    node_label(node)
                ));
            }
            if ctx.parent.is_some_and(|p| matches!(p, "select" | "optgroup")) {
                return Err(format!(
                    "{} inside <{}>: the parser drops everything but options there",
                    node_label(node),
                    ctx.parent.unwrap()
                ));
            }
            Ok(())
        }
        ViewNode::Fragment(children) => children.iter().try_for_each(|c| walk(c, ctx, mode)),
    }
}

fn element(
    tag: &str,
    props: &[Prop],
    children: &[ViewNode],
    ctx: Ctx,
    mode: Mode,
) -> Result<(), String> {
    if !is_safe_name(tag) {
        return Err(format!("<{tag}>: the tokenizer does not read that name back"));
    }
    // Inside SVG/MathML the HTML content model does not apply at all; the parser takes
    // the nesting as written, so only the foreign-content entry itself is checked.
    if ctx.foreign {
        return children.iter().try_for_each(|c| walk(c, child_ctx(tag, ctx, true), mode));
    }
    if mode == Mode::Clone {
        if NEVER.contains(&tag) {
            return Err(format!("<{tag}>: the parser handles it specially"));
        }
    } else if let Some(reason) = adopt_refuses(tag, ctx) {
        return Err(reason);
    }
    // A void element's children would be silently dropped by the parser.
    if VOID.contains(&tag) && !children.is_empty() {
        return Err(format!("<{tag}> with children: it is a void element, so they are dropped"));
    }
    // Raw text comes back as exactly one text node — no markup inside it is parsed, so
    // the claim walk has one node to work with however many children were written.
    // `ssg::raw_text_mode` emits the content bare (no hole markers) for the same reason.
    if mode == Mode::Adopt
        && is_raw_text(tag)
        && (children.len() > 1
            || children.iter().any(|c| !matches!(c, ViewNode::Text(_) | ViewNode::Dynamic { .. })))
    {
        return Err(format!(
            "<{tag}> with more than one piece of content: its text is not parsed as \
             markup, so the pieces come back as a single text node"
        ));
    }
    // Table parts are ignored outside a table, and a table's children are rebuilt into
    // the canonical shape — so both directions have to match.
    let parent_model = ctx.parent.and_then(table_children);
    match (TABLE_PART.contains(&tag), parent_model) {
        (true, Some(allowed)) if allowed.contains(&tag) => {}
        (true, Some(_)) => {
            // The one that actually happens: rows written straight under the table. The
            // parser wraps them in an implied section — and a region's markers stay behind
            // in the table while its rows move into it.
            let hint = if tag == "tr" { " — wrap them in a <tbody>" } else { "" };
            return Err(format!(
                "<{tag}> directly inside <{}>: the parser rebuilds the table's structure \
                 around it{hint}",
                ctx.parent.unwrap_or_default()
            ));
        }
        (true, None) => return Err(format!("<{tag}> outside a table: the parser drops it")),
        (false, Some(_)) => return Err(table_text_err(ctx)),
        (false, None) => {}
    }
    // The self-closing cases: each of these ends an open element of its own kind
    // rather than nesting inside it.
    let closes = if ctx.in_p && CLOSES_P.contains(&tag) {
        Some("p")
    } else if ctx.in_a && tag == "a" {
        Some("a")
    } else if ctx.in_button && tag == "button" {
        Some("button")
    } else if ctx.in_li && tag == "li" {
        Some("li")
    } else if ctx.in_item && matches!(tag, "dd" | "dt") {
        Some("dd/dt")
    // `<h2>` directly inside `<h1>` pops the h1 (the rule fires only when the heading
    // is the *current* node, so any element between them is enough to make it safe).
    } else if is_heading(tag) && ctx.parent.is_some_and(is_heading) {
        Some("heading")
    } else {
        None
    };
    if let Some(open) = closes {
        return Err(format!("<{tag}> inside <{open}>: the parser closes the <{open}> before it"));
    }
    if ctx.in_form && tag == "form" {
        return Err("<form> inside <form>: the parser ignores the nested one".into());
    }
    if ctx.parent.is_some_and(|p| matches!(p, "select" | "optgroup")) && !select_allows(tag) {
        return Err(format!(
            "<{tag}> inside <{}>: the parser drops everything but options there",
            ctx.parent.unwrap()
        ));
    }
    if mode == Mode::Clone && !props_round_trip(props) {
        return Err(format!("<{tag}>: an attribute the parser reads back differently"));
    }
    // Inside a table's structure, only table parts may appear — stray text is
    // foster-parented out in front of the table.
    if mode == Mode::Clone
        && table_children(tag).is_some()
        && !children.iter().all(|c| matches!(c, ViewNode::Element { .. }))
    {
        return Err(format!("<{tag}> with non-element children"));
    }
    let foreign = matches!(tag, "svg" | "math");
    children.iter().try_for_each(|c| walk(c, child_ctx(tag, ctx, foreign), mode))
}

fn child_ctx<'a>(tag: &'a str, ctx: Ctx<'a>, foreign: bool) -> Ctx<'a> {
    if foreign {
        return Ctx { parent: Some(tag), foreign: true, ..Ctx::default() };
    }
    let barrier = SCOPE_BARRIER.contains(&tag);
    Ctx {
        parent: Some(tag),
        in_p: !barrier && (ctx.in_p || tag == "p"),
        in_a: !FORMAT_MARKER.contains(&tag) && (ctx.in_a || tag == "a"),
        // `<button>` bounds button scope, but it is also what the search is *for* — the
        // walk stops at the enclosing button by matching it — so it does not shield a
        // button nested inside it the way it shields a `<p>`.
        in_button: (!barrier || tag == "button") && (ctx.in_button || tag == "button"),
        in_li: !ITEM_BARRIER.contains(&tag) && (ctx.in_li || tag == "li"),
        in_item: !ITEM_BARRIER.contains(&tag) && (ctx.in_item || matches!(tag, "dd" | "dt")),
        in_form: ctx.in_form || tag == "form",
        foreign: false,
    }
}

/// Tags the *adopt* walk refuses outright — the subset of [`NEVER`] whose special
/// handling changes the tree's shape (rather than only its bytes, which is what the
/// clone path additionally cares about).
fn adopt_refuses(tag: &str, ctx: Ctx) -> Option<String> {
    let reason = match tag {
        // A nested template's children land in its `.content` fragment, not the tree.
        "template" => "the parser puts its children in a document fragment",
        // Renamed by the tokenizer: `<image>` is inserted as `img`.
        "image" => "the parser inserts it as <img>",
        // Dropped, merged into the existing document, or relocated.
        "html" | "head" | "body" | "frame" | "frameset" => "the parser relocates it",
        // Imply an end tag on a sibling start tag of their own kind.
        "nobr" | "rb" | "rp" | "rt" | "rtc" | "plaintext" => "the parser implies an end tag for it",
        _ => return None,
    };
    let _ = ctx;
    Some(format!("<{tag}>: {reason}"))
}

/// A start tag the parser keeps inside `<select>`/`<optgroup>` (everything else is a
/// parse error and is ignored).
fn select_allows(tag: &str) -> bool {
    matches!(tag, "option" | "optgroup" | "hr" | "script")
}

fn table_text_err(ctx: Ctx) -> String {
    format!(
        "content inside <{}> that is not a table part: the parser moves it out in front \
         of the table",
        ctx.parent.unwrap_or_default()
    )
}

fn node_label(node: &ViewNode) -> &'static str {
    match node {
        ViewNode::Component { .. } => "a component",
        ViewNode::Children => "a {children} slot",
        _ => "dynamic content",
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

    // ── reparse_hazard (the hydrate gate) ────────────────────────────────────
    //
    // Same parser model, asked of a *dynamic* view: does the server HTML come back
    // as the tree the positional claim walk was generated against?

    fn hole() -> ViewNode {
        ViewNode::Dynamic { expr: ExpressionId(0) }
    }

    fn component(name: &str) -> ViewNode {
        ViewNode::Component { name: name.into(), props: vec![], children: vec![] }
    }

    fn list(item: ViewNode) -> ViewNode {
        ViewNode::List {
            source: ExpressionId(0),
            source_branches: vec![],
            item_param: "it".into(),
            index_param: None,
            item: Box::new(item),
            key: None,
            preamble: vec![],
        }
    }

    #[test]
    fn an_ordinary_reactive_view_adopts() {
        let tree = wrap(vec![
            el("p", vec![], vec![text("count "), hole()]),
            el("ul", vec![], vec![list(el("li", vec![], vec![hole()]))]),
            el(
                "table",
                vec![],
                vec![el("tbody", vec![], vec![el("tr", vec![], vec![el("td", vec![], vec![hole()])])])],
            ),
            component("Card"),
        ]);
        assert_eq!(reparse_hazard(&tree), None);
    }

    #[test]
    fn a_block_element_in_a_paragraph_is_a_hazard() {
        let tree = wrap(vec![el("p", vec![], vec![hole(), el("div", vec![], vec![text("x")])])]);
        assert!(reparse_hazard(&tree).is_some_and(|r| r.contains("<div> inside <p>")));
    }

    #[test]
    fn an_island_in_a_paragraph_is_a_hazard() {
        // The component's *own* view may start with a block element, which closes the
        // `<p>` and hoists the host out of it — leaving the walk nothing to claim.
        let tree = wrap(vec![el("p", vec![], vec![text("a "), component("Box"), text(" b")])]);
        assert!(reparse_hazard(&tree).is_some_and(|r| r.contains("a component inside <p>")));
        // …but the same island as a sibling of the paragraph is fine.
        let sibling = wrap(vec![el("p", vec![], vec![text("a")]), component("Box")]);
        assert_eq!(reparse_hazard(&sibling), None);
    }

    #[test]
    fn unknown_content_inside_an_anchor_or_list_item_still_adopts() {
        // `<a>{children}</a>` is the `Link` component, and `<li><Icon/></li>` is every
        // nav. Neither is at risk: an `<a>` is closed only by another `<a>` start tag (a
        // `<div>` inside one is valid HTML the parser keeps), and an `<li>` only by
        // another `<li>` — unlike `<p>`, which any block-level tag ends.
        assert_eq!(reparse_hazard(&wrap(vec![el("a", vec![], vec![ViewNode::Children])])), None);
        assert_eq!(
            reparse_hazard(&wrap(vec![el("ul", vec![], vec![el("li", vec![], vec![component("Icon")])])])),
            None
        );
        assert_eq!(reparse_hazard(&wrap(vec![el("button", vec![], vec![component("Icon")])])), None);
    }

    #[test]
    fn implied_end_tags_are_hazards() {
        for (outer, inner) in [("a", "a"), ("button", "button"), ("li", "li"), ("form", "form")] {
            let tree = wrap(vec![el(outer, vec![], vec![el(inner, vec![], vec![hole()])])]);
            assert!(
                reparse_hazard(&tree).is_some(),
                "<{inner}> inside <{outer}> must refuse adoption"
            );
        }
    }

    #[test]
    fn a_table_the_parser_rebuilds_is_a_hazard() {
        // A bare `<tr>` under `<table>` gains an implied `<tbody>` (lowering normalizes
        // the static shape; a dynamic one still has to be refused).
        let bare_row = el("table", vec![], vec![el("tr", vec![], vec![el("td", vec![], vec![hole()])])]);
        assert!(reparse_hazard(&bare_row).is_some());
        // A list region directly inside the table: the rows move into an implied section
        // but the `<!--[-->`/`<!--]-->` markers do not follow them.
        let rows = el("table", vec![], vec![list(el("tr", vec![], vec![el("td", vec![], vec![hole()])]))]);
        assert!(reparse_hazard(&rows).is_some_and(|r| r.contains("<tbody>")));
        // Wrapped in a section, the same list adopts.
        let wrapped = el(
            "table",
            vec![],
            vec![el("tbody", vec![], vec![list(el("tr", vec![], vec![el("td", vec![], vec![hole()])]))])],
        );
        assert_eq!(reparse_hazard(&wrapped), None);
    }

    #[test]
    fn raw_text_holds_one_piece_of_content() {
        // One hole is adoptable (`claimRawText` binds the element's single text node)…
        assert_eq!(reparse_hazard(&wrap(vec![el("textarea", vec![], vec![hole()])])), None);
        // …but static text *and* a hole come back as one merged text node.
        let mixed = wrap(vec![el("textarea", vec![], vec![text("a"), hole()])]);
        assert!(mixed.clone().pipe_hazard().contains("single text node"));
        // An element inside raw text is not markup at all.
        let markup = wrap(vec![el("title", vec![], vec![el("b", vec![], vec![text("x")])])]);
        assert!(reparse_hazard(&markup).is_some());
    }

    #[test]
    fn foreign_content_is_taken_as_written() {
        // Inside SVG the HTML content model does not apply: `<title>` there is a real
        // element, and nothing implies an end tag.
        let svg = wrap(vec![el(
            "svg",
            vec![],
            vec![el("title", vec![], vec![text("t")]), el("g", vec![], vec![el("path", vec![], vec![])])],
        )]);
        assert_eq!(reparse_hazard(&svg), None);
    }

    /// Test helper: the hazard reason, panicking when the shape was accepted.
    trait PipeHazard {
        fn pipe_hazard(self) -> String;
    }
    impl PipeHazard for ViewNode {
        fn pipe_hazard(self) -> String {
            reparse_hazard(&self).expect("expected a reparse hazard")
        }
    }
}

