//! Internal static HTML search indexer for `@opentf/web-docs`.
//! See packages/web-docs/search/SPEC-FORMAT.md for the writer/reader contract.

use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::ExitCode,
};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
use walkdir::WalkDir;

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("build") => build_cmd(&args),
        Some("inspect") => inspect_cmd(&args),
        Some("query") => query_cmd(&args),
        _ => {
            eprintln!("usage: otf-search <build|inspect|query> …");
            ExitCode::FAILURE
        }
    }
}

fn build_cmd(args: &[String]) -> ExitCode {
    let Some(site) = args.get(1) else {
        eprintln!("otf-search: missing export directory");
        return ExitCode::FAILURE;
    };
    let mut out = PathBuf::from(site).join("_search");
    let mut root = "main".to_string();
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                i += 1;
                if let Some(value) = args.get(i) {
                    out = PathBuf::from(value);
                }
            }
            "--root" => {
                i += 1;
                if let Some(value) = args.get(i) {
                    root = value.clone();
                }
            }
            flag => {
                eprintln!("otf-search: unknown option {flag}");
                return ExitCode::FAILURE;
            }
        }
        i += 1;
    }
    match build(Path::new(site), &out, &root) {
        Ok(count) => {
            eprintln!("otf-search: indexed {count} page(s) → {}", out.display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("otf-search: {error}");
            ExitCode::FAILURE
        }
    }
}

fn read_index(dir: &str) -> Result<Value, String> {
    let dir = Path::new(dir);
    let manifest: Value =
        serde_json::from_slice(&fs::read(dir.join("manifest.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if manifest["v"] != 1 {
        return Err("Unsupported search index version".into());
    }
    let mut terms = serde_json::Map::new();
    for chunk in manifest["chunks"].as_array().ok_or("Missing term chunks")? {
        let bytes = fs::read(dir.join(chunk["file"].as_str().ok_or("Missing chunk filename")?))
            .map_err(|e| e.to_string())?;
        terms.extend(decode_term_chunk(&bytes)?);
    }
    let mut docs = Vec::new();
    let fragments = manifest["fragmentsDir"].as_str().unwrap_or("f");
    for id in 0..manifest["docs"].as_u64().ok_or("Missing document count")? {
        let bytes =
            fs::read(dir.join(fragments).join(format!("{id}.json"))).map_err(|e| e.to_string())?;
        docs.push(serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())?);
    }
    Ok(json!({"terms": terms, "docs": docs}))
}

fn inspect_cmd(args: &[String]) -> ExitCode {
    let (Some(dir), Some(flag), Some(term)) = (args.get(1), args.get(2), args.get(3)) else {
        eprintln!("usage: otf-search inspect <index-dir> --term <term>");
        return ExitCode::FAILURE;
    };
    if flag != "--term" {
        eprintln!("usage: otf-search inspect <index-dir> --term <term>");
        return ExitCode::FAILURE;
    }
    match read_index(dir).and_then(|index| Ok(index["terms"][term.to_lowercase()].clone())) {
        Ok(Value::Null) => {
            println!(
                "{{\"term\":{},\"df\":0,\"postings\":[]}}",
                serde_json::to_string(term).unwrap()
            );
            ExitCode::SUCCESS
        }
        Ok(postings) => {
            println!(
                "{{\"term\":{},\"df\":{},\"postings\":{}}}",
                serde_json::to_string(term).unwrap(),
                postings.as_array().map_or(0, Vec::len),
                postings
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("otf-search: {error}");
            ExitCode::FAILURE
        }
    }
}

fn query_cmd(args: &[String]) -> ExitCode {
    let (Some(dir), Some(query)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: otf-search query <index-dir> <query>");
        return ExitCode::FAILURE;
    };
    let index = match read_index(dir) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("otf-search: {error}");
            return ExitCode::FAILURE;
        }
    };
    let mut scores: BTreeMap<usize, u64> = BTreeMap::new();
    for term in tokens(query) {
        for posting in index["terms"][term.as_str()]
            .as_array()
            .into_iter()
            .flatten()
        {
            if let (Some(doc), Some(tf)) = (posting[0].as_u64(), posting[1].as_u64()) {
                *scores.entry(doc as usize).or_default() += tf;
            }
        }
    }
    let mut ranked: Vec<_> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let results: Vec<_> = ranked.into_iter().take(10).filter_map(|(doc, score)| index["docs"].get(doc).map(|fragment| json!({"url": fragment["url"], "title": fragment["title"], "score": score}))).collect();
    println!("{}", json!({"results": results}));
    ExitCode::SUCCESS
}

fn build(site: &Path, out: &Path, root: &str) -> Result<usize, String> {
    if !site.is_dir() {
        return Err(format!(
            "Search site directory does not exist: {}",
            site.display()
        ));
    }
    let mut paths: Vec<PathBuf> = WalkDir::new(site)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.path().extension().is_some_and(|x| x == "html")
        })
        .map(|entry| entry.into_path())
        .collect();
    paths.sort(); // Document IDs and output are deterministic.
    let mut terms: BTreeMap<String, BTreeMap<usize, Vec<(u32, u8)>>> = BTreeMap::new();
    let mut fragments = Vec::new();
    let mut lengths = Vec::new();
    let pages: Vec<_> = paths
        .iter()
        .map(|path| {
            fs::read_to_string(path)
                .map(|html| (path, Html::parse_document(&html)))
                .map_err(|e| format!("{}: {e}", path.display()))
        })
        .collect::<Result<_, _>>()?;
    let marked = Selector::parse("[data-otf-search-body], [data-pagefind-body]").unwrap();
    let explicit = pages
        .iter()
        .any(|(_, page)| page.select(&marked).next().is_some());
    for (path, page) in pages {
        let Some(document) = extract_document(&page, root, explicit)? else {
            continue;
        };
        let id = fragments.len();
        lengths.push(document.length);
        for (term, position, field) in document.terms {
            terms
                .entry(term)
                .or_default()
                .entry(id)
                .or_default()
                .push((position, field));
        }
        let title = if document.title.is_empty() {
            relative_url(site, path)
        } else {
            document.title
        };
        for term in tokens(&title) {
            terms
                .entry(term)
                .or_default()
                .entry(id)
                .or_default()
                .push((0, 0));
        }
        fragments.push(
            json!({"url": relative_url(site, path), "title": title, "text": document.text,
            "meta": document.meta, "anchors": document.anchors, "excerptOmit": document.excerpt_omit}),
        );
    }
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    for docs in terms.values_mut() {
        for positions in docs.values_mut() {
            positions.sort_by_key(|(position, field)| (*position, *field));
        }
    }
    fs::create_dir_all(out.join("t")).map_err(|e| e.to_string())?;
    let entries: Vec<_> = terms.iter().collect();
    let mut chunks = Vec::new();
    // 750 terms keeps real-world docs shards near the 12 KB compressed request budget.
    for group in entries.chunks(750) {
        let shard: BTreeMap<_, _> = group
            .iter()
            .map(|(term, docs)| ((*term).clone(), (*docs).clone()))
            .collect();
        let (bytes, first, count) = encode_term_chunk(&shard);
        let hash = blake3::hash(&bytes).to_hex().to_string()[..12].to_string();
        let file = format!("t/{hash}.bin");
        fs::write(out.join(&file), bytes).map_err(|e| e.to_string())?;
        chunks.push(json!({"first": first, "file": file, "terms": count}));
    }
    // The complete fragment generation is immutable, including its document IDs.
    let payloads = fragments
        .iter()
        .map(serde_json::to_vec)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut hasher = blake3::Hasher::new();
    for bytes in &payloads {
        hasher.update(&(bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    let generation = hasher.finalize().to_hex().to_string();
    let fragments_name = format!("f/{generation}");
    let fragments_dir = out.join(&fragments_name);
    fs::create_dir_all(&fragments_dir).map_err(|e| e.to_string())?;
    for (id, bytes) in payloads.iter().enumerate() {
        fs::write(fragments_dir.join(format!("{id}.json")), bytes).map_err(|e| e.to_string())?;
    }
    let mut docs_bin = Vec::new();
    for length in &lengths {
        write_varint(*length as u64, &mut docs_bin);
    }
    let docs_hash = blake3::hash(&docs_bin).to_hex().to_string()[..12].to_string();
    let docs_file = format!("docs.{docs_hash}.bin");
    fs::write(out.join(&docs_file), &docs_bin).map_err(|e| e.to_string())?;
    let avgdl = if lengths.is_empty() {
        0.0
    } else {
        lengths.iter().sum::<usize>() as f64 / lengths.len() as f64
    };
    fs::write(out.join("manifest.json"), serde_json::to_vec(&json!({"v": 1, "docs": lengths.len(), "avgdl": avgdl, "docsFile": docs_file, "fragmentsDir": fragments_name, "chunks": chunks})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(lengths.len())
}

fn write_varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn encode_term_chunk(
    terms: &BTreeMap<String, BTreeMap<usize, Vec<(u32, u8)>>>,
) -> (Vec<u8>, String, usize) {
    let mut postings = Vec::new();
    let mut rows = Vec::new();
    let mut previous = Vec::new();
    for (term, docs) in terms {
        let offset = postings.len();
        let mut last_doc = 0usize;
        for (&doc, positions) in docs {
            write_varint((doc - last_doc) as u64, &mut postings);
            write_varint(positions.len() as u64, &mut postings);
            let mut last_position = 0u32;
            for &(position, field) in positions {
                write_varint(
                    (((position - last_position) << 3) | field as u32) as u64,
                    &mut postings,
                );
                last_position = position;
            }
            last_doc = doc;
        }
        let bytes = term.as_bytes();
        let common = bytes
            .iter()
            .zip(previous.iter())
            .take_while(|(a, b)| a == b)
            .count();
        rows.push((common, bytes[common..].to_vec(), docs.len(), offset));
        previous = bytes.to_vec();
    }
    let mut out = b"OTFI".to_vec();
    out.push(1);
    write_varint(rows.len() as u64, &mut out);
    for (prefix, suffix, df, offset) in rows {
        write_varint(prefix as u64, &mut out);
        write_varint(suffix.len() as u64, &mut out);
        out.extend(suffix);
        write_varint(df as u64, &mut out);
        write_varint(offset as u64, &mut out);
    }
    out.extend(postings);
    (
        out,
        terms.keys().next().cloned().unwrap_or_default(),
        terms.len(),
    )
}

fn read_varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0;
    for shift in (0..=63).step_by(7) {
        let byte = *bytes.get(*cursor).ok_or("Truncated search index")?;
        *cursor += 1;
        if shift == 63 && byte > 1 {
            return Err("Invalid search integer".into());
        }
        value |= ((byte & 127) as u64) << shift;
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    Err("Invalid search integer".into())
}
fn decode_term_chunk(bytes: &[u8]) -> Result<serde_json::Map<String, Value>, String> {
    if bytes.get(..5) != Some(b"OTFI\x01") {
        return Err("Unsupported search term chunk".into());
    }
    let mut cursor = 5;
    let count = read_varint(bytes, &mut cursor)?;
    let mut rows = Vec::new();
    let mut previous = Vec::new();
    for _ in 0..count {
        let prefix = read_varint(bytes, &mut cursor)? as usize;
        let length = read_varint(bytes, &mut cursor)? as usize;
        let mut term = previous
            .get(..prefix)
            .ok_or("Invalid term prefix")?
            .to_vec();
        let end = cursor.checked_add(length).ok_or("Invalid term length")?;
        term.extend_from_slice(bytes.get(cursor..end).ok_or("Truncated search term")?);
        cursor = end;
        let name = String::from_utf8(term.clone()).map_err(|e| e.to_string())?;
        rows.push((
            name,
            read_varint(bytes, &mut cursor)?,
            read_varint(bytes, &mut cursor)?,
        ));
        previous = term;
    }
    let blob = cursor;
    let mut out = serde_json::Map::new();
    for (term, df, offset) in rows {
        let mut cursor = blob
            .checked_add(offset as usize)
            .ok_or("Invalid posting offset")?;
        let mut doc = 0;
        let mut postings = Vec::new();
        for _ in 0..df {
            doc += read_varint(bytes, &mut cursor)?;
            let tf = read_varint(bytes, &mut cursor)?;
            let mut position = 0;
            let mut positions = Vec::new();
            for _ in 0..tf {
                let packed = read_varint(bytes, &mut cursor)?;
                position += packed >> 3;
                positions.push(json!([position, packed & 7]));
            }
            postings.push(json!([doc, tf, positions]));
        }
        out.insert(term, json!(postings));
    }
    Ok(out)
}

#[derive(Default)]
struct Document {
    text: String,
    title: String,
    meta: BTreeMap<String, String>,
    anchors: Vec<Value>,
    excerpt_omit: Vec<(usize, usize)>,
    terms: Vec<(String, u32, u8)>,
    length: usize,
}

fn word_regex() -> &'static Regex {
    static WORD: OnceLock<Regex> = OnceLock::new();
    WORD.get_or_init(|| Regex::new(r"[\p{L}\p{N}\p{M}_.-]+").unwrap())
}

// The same groups and normalization are used by the JS reader. Variants of one
// word share an offset; accent folding/camelCase splitting are alternatives.
fn variants(word: &str) -> Vec<String> {
    let normalized: String = word.nfkc().collect();
    let whole = normalized.to_lowercase();
    if !whole.chars().any(char::is_alphanumeric) {
        return vec![];
    }
    let mut out = vec![whole.clone()];
    let folded: String = whole.nfd().filter(|ch| !is_combining_mark(*ch)).collect();
    if folded != whole {
        out.push(folded);
    }
    let mut parts = String::new();
    let mut previous = None;
    for ch in normalized.chars() {
        if ch.is_ascii_uppercase() && previous.is_some_and(|c: char| c.is_ascii_lowercase()) {
            parts.push(' ');
        }
        parts.push(ch);
        previous = Some(ch);
    }
    for part in parts
        .split(['_', '-', '.', ' '])
        .filter(|part| !part.is_empty())
    {
        let part = part.to_lowercase();
        if !out.contains(&part) {
            out.push(part);
        }
    }
    out
}
fn tokens(text: &str) -> Vec<String> {
    word_regex()
        .find_iter(text)
        .flat_map(|word| variants(word.as_str()))
        .collect()
}

fn ignored(element: ElementRef<'_>) -> bool {
    let e = element.value();
    matches!(
        e.name(),
        "script" | "style" | "noscript" | "nav" | "header" | "footer" | "aside"
    ) || e.attr("data-otf-search-ignore").is_some()
        || e.attr("data-pagefind-ignore").is_some()
        || e.attr("hidden").is_some()
        || e.attr("aria-hidden") == Some("true")
}
fn normalized_text(element: ElementRef<'_>) -> String {
    fn visible_text(element: ElementRef<'_>, text: &mut Vec<String>, root: bool) {
        let e = element.value();
        if matches!(e.name(), "script" | "style" | "noscript" | "template" | "svg")
            || e.attr("hidden").is_some()
            || e.attr("aria-hidden") == Some("true")
            || (!root && (e.attr("data-otf-search-ignore").is_some()
                || e.attr("data-pagefind-ignore").is_some()))
        {
            return;
        }
        for child in element.children() {
            if let Some(el) = ElementRef::wrap(child) {
                visible_text(el, text, false);
            } else if let Some(node) = child.value().as_text() {
                let value = node.text.split_whitespace().collect::<Vec<_>>().join(" ");
                if !value.is_empty() {
                    text.push(value);
                }
            }
        }
    }
    let mut text = Vec::new();
    visible_text(element, &mut text, true);
    text.join(" ")
}

fn extract_document(page: &Html, root: &str, explicit: bool) -> Result<Option<Document>, String> {
    let selector = Selector::parse(if explicit {
        "[data-otf-search-body], [data-pagefind-body]"
    } else {
        root
    })
    .map_err(|e| format!("Invalid search root selector: {e}"))?;
    let roots: Vec<_> = page
        .select(&selector)
        .filter(|el| {
            !el.ancestors()
                .filter_map(ElementRef::wrap)
                .any(|ancestor| ignored(ancestor) || selector.matches(&ancestor))
        })
        .collect();
    if roots.is_empty() {
        return Ok(None);
    }
    let mut document = Document::default();
    // Metadata may live outside the selected body (for example breadcrumbs).
    for el in page.select(&Selector::parse("[data-otf-search-meta], [data-pagefind-meta]").unwrap())
    {
        if std::iter::once(el)
            .chain(el.ancestors().filter_map(ElementRef::wrap))
            .any(|e| {
                e.value().attr("data-otf-search-ignore") == Some("all")
                    || e.value().attr("data-pagefind-ignore") == Some("all")
            })
        {
            continue;
        }
        if let Some(attr) = el
            .value()
            .attr("data-otf-search-meta")
            .or_else(|| el.value().attr("data-pagefind-meta"))
        {
            let (key, value) = attr
                .split_once(':')
                .map(|(key, value)| (key.trim(), value.to_string()))
                .unwrap_or_else(|| (attr.trim(), normalized_text(el)));
            if !key.is_empty() {
                document.meta.insert(key.to_string(), value);
            }
        }
    }
    let mut spans = Vec::new();
    for el in roots {
        walk(el, 6, &mut document, &mut spans);
    }
    document.text = document.text.trim_end().to_string();
    if document.title.is_empty() {
        if let Some(el) = page.select(&Selector::parse("title").unwrap()).next() {
            document.title = normalized_text(el);
        }
    }
    // Positions are UTF-16 offsets into the normalized fragment text, matching JS.
    let mut previous = 0;
    let mut position = 0;
    for word in word_regex().find_iter(&document.text) {
        position += document.text[previous..word.start()].encode_utf16().count() as u32;
        previous = word.start();
        let field = spans
            .iter()
            .find(|(start, end, _)| *start <= word.start() && word.start() < *end)
            .map_or(6, |(_, _, field)| *field);
        let variants = variants(word.as_str());
        if !variants.is_empty() {
            document.length += 1;
        }
        for term in variants {
            document.terms.push((term, position, field));
        }
    }
    Ok(Some(document))
}

fn walk(
    el: ElementRef<'_>,
    inherited: u8,
    doc: &mut Document,
    spans: &mut Vec<(usize, usize, u8)>,
) {
    if ignored(el) {
        return;
    }
    let name = el.value().name();
    // Code toolbar labels are UI chrome, not documentation content.
    if el.value().classes().any(|class| class == "otfw-code-head") {
        return;
    }
    let field = match name {
        "h1" => 0,
        "h2" => 1,
        "h3" => 2,
        "h4" | "h5" | "h6" => 3,
        "pre" | "code" => 4,
        _ => inherited,
    };
    let block = matches!(
        name,
        "main"
            | "article"
            | "section"
            | "div"
            | "p"
            | "pre"
            | "br"
            | "li"
            | "tr"
            | "td"
            | "th"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
    );
    let space = |text: &mut String| {
        if !text.is_empty() && !text.ends_with(' ') {
            text.push(' ');
        }
    };
    if block {
        space(&mut doc.text);
    }
    let start = doc.text.len();
    for child in el.children() {
        if let Some(element) = ElementRef::wrap(child) {
            walk(element, field, doc, spans);
        } else if let Some(text) = child.value().as_text() {
            let begin = doc.text.len();
            for ch in text.text.chars() {
                if ch.is_whitespace() {
                    space(&mut doc.text);
                } else {
                    doc.text.push(ch);
                }
            }
            let end = doc.text.len();
            if begin < end {
                spans.push((begin, end, field));
            }
        }
    }
    if name.starts_with('h') && matches!(name, "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
        let heading = doc.text[start..].trim().to_string();
        if name == "h1" && doc.title.is_empty() {
            doc.title = heading.clone();
        }
        if let Some(id) = el.value().attr("id") {
            doc.anchors.push(
                json!({"id": id, "text": heading, "pos": doc.text[..start].encode_utf16().count()}),
            );
        }
    }
    // Keep examples searchable, but omit block code from prose result previews.
    if name == "pre" {
        doc.excerpt_omit.push((
            doc.text[..start].encode_utf16().count(),
            doc.text.encode_utf16().count(),
        ));
    }
    if block {
        space(&mut doc.text);
    }
}
fn relative_url(site: &Path, path: &Path) -> String {
    let rel = path
        .strip_prefix(site)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    if rel == "index.html" {
        "/".into()
    } else {
        format!("/{}", rel.strip_suffix("index.html").unwrap_or(&rel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markup_and_code_toolbars_are_not_indexed_and_examples_have_preview_omissions() {
        let html = "<main data-otf-search-body><h2 id='styling'>Styling</h2><p>😀 Use <code>class</code> as usual.</p><div class='otfw-code-head'>JSX Copy</div><pre><code>&lt;div class=\"card\"&gt;example&lt;/div&gt;</code></pre><p data-unwanted='AttributeNoise'>Scoped styles.</p></main>";
        let doc = extract_document(&Html::parse_document(html), "main", true).unwrap().unwrap();
        assert!(!doc.text.contains("Copy"));
        assert!(!doc.text.contains("AttributeNoise"));
        assert!(doc.terms.iter().any(|(term, _, _)| term == "card"));
        let utf16 = doc.text.encode_utf16().collect::<Vec<_>>();
        let (start, end) = doc.excerpt_omit[0];
        assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), "<div class=\"card\">example</div>");
    }

    #[test]
    fn metadata_uses_visible_labels_and_excludes_structured_data() {
        let html = r#"<main data-otf-search-body><h1>Reactivity</h1></main>
          <nav data-otf-search-meta="breadcrumb"><web-raw-html><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script></web-raw-html>
          <span>Core Concepts</span><span>/</span><a>Reactivity</a>
          <style>StyleNoise</style><template>TemplateNoise</template><span hidden>HiddenNoise</span>
          <span aria-hidden="true">DecorationNoise</span><span data-otf-search-ignore>IgnoredNoise</span></nav>"#;
        let doc = extract_document(&Html::parse_document(html), "main", true).unwrap().unwrap();
        assert_eq!(doc.meta["breadcrumb"], "Core Concepts / Reactivity");
        assert_eq!(doc.text, "Reactivity");
    }

    #[test]
    fn tokenizer_matches_phase_one_vectors() {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../packages/web-docs/search/tokenizer-vectors.json"
        ))
        .unwrap();
        for vector in vectors.as_array().unwrap() {
            let expected: Vec<String> = vector["tokens"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            assert_eq!(
                tokens(vector["input"].as_str().unwrap()),
                expected,
                "{}",
                vector["input"]
            );
        }
    }

    #[test]
    fn extraction_uses_main_and_drops_non_content_regions() {
        let html = r#"<html><head><title>Ignored</title></head><body><header>Header</header><main><h1>Guide</h1><p>Useful <strong>routing</strong> text.</p><aside>Aside</aside><code>route.params</code></main><footer>Footer</footer></body></html>"#;
        let doc = extract_document(&Html::parse_document(html), "main", false)
            .unwrap()
            .unwrap();
        assert_eq!(doc.text, "Guide Useful routing text. route.params");
        assert_eq!(doc.title, "Guide");
    }

    #[test]
    fn urls_are_stable_for_index_and_nested_pages() {
        let root = Path::new("/site");
        assert_eq!(relative_url(root, Path::new("/site/index.html")), "/");
        assert_eq!(
            relative_url(root, Path::new("/site/guide/index.html")),
            "/guide/"
        );
        assert_eq!(
            relative_url(root, Path::new("/site/guide/page.html")),
            "/guide/page.html"
        );
    }
    #[test]
    fn extraction_bounds_content_decodes_entities_and_preserves_metadata() {
        let html = r#"<html><body><h1>Wrong title</h1><nav data-pagefind-meta='breadcrumb'>Docs &amp; Guides</nav>
          <main data-pagefind-body><h1>Right &amp; title</h1><p>route.<em>params</em> &lt;tag&gt;</p>
          <div data-pagefind-ignore>ignored</div><span data-otf-search-ignore>also ignored</span>
          <span data-otf-search-ignore='all' data-otf-search-meta='secret:value'>private</span>
          <span aria-hidden='true'>anchor decoration</span><span hidden data-pagefind-meta='section:Docs'></span>
          </main><div>outside</div></body></html>"#;
        let doc = extract_document(&Html::parse_document(html), "main", true)
            .unwrap()
            .unwrap();
        assert_eq!(doc.title, "Right & title");
        assert_eq!(doc.text, "Right & title route.params <tag>");
        assert_eq!(doc.meta["breadcrumb"], "Docs & Guides");
        assert_eq!(doc.meta["section"], "Docs");
        assert!(!doc.meta.contains_key("secret"));
        assert!(doc.terms.iter().any(|(term, _, _)| term == "route.params"));
    }

    #[test]
    fn positions_and_anchors_use_utf16_offsets() {
        let html = "<main><p>😀 café</p><h2 id='more'>Routing</h2><pre>route.params</pre></main>";
        let doc = extract_document(&Html::parse_document(html), "main", false)
            .unwrap()
            .unwrap();
        let offset = doc.text[..doc.text.find("Routing").unwrap()]
            .encode_utf16()
            .count();
        assert_eq!(doc.anchors[0]["pos"], offset);
        assert!(doc
            .terms
            .iter()
            .any(|(term, pos, field)| term == "routing" && *pos == offset as u32 && *field == 1));
        let pos = doc
            .terms
            .iter()
            .find(|(term, _, _)| term == "café")
            .unwrap()
            .1;
        assert!(doc
            .terms
            .iter()
            .any(|(term, p, _)| term == "cafe" && *p == pos));
    }

    #[test]
    fn nested_roots_do_not_duplicate_content_and_empty_roots_are_skipped() {
        let page = Html::parse_document(
            "<main data-otf-search-body>One<article data-otf-search-body>Two</article></main>",
        );
        assert_eq!(
            extract_document(&page, "main", true).unwrap().unwrap().text,
            "One Two"
        );
        assert!(extract_document(
            &Html::parse_document("<main>Not opted in</main>"),
            "main",
            true
        )
        .unwrap()
        .is_none());
        assert!(extract_document(&page, "[", false).is_err());
    }

    #[test]
    fn binary_roundtrip_rejects_truncated_postings() {
        let terms = BTreeMap::from([("café".into(), BTreeMap::from([(2, vec![(8, 1), (12, 6)])]))]);
        let (bytes, _, _) = encode_term_chunk(&terms);
        assert_eq!(
            decode_term_chunk(&bytes).unwrap()["café"],
            json!([[2, 2, [[8, 1], [12, 6]]]])
        );
        assert!(decode_term_chunk(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn builds_immutable_generations_and_cli_reads_the_binary_index() {
        let dir = std::env::temp_dir().join(format!("otf-search-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("_search");
        fs::write(
            dir.join("index.html"),
            "<main data-otf-search-body><h1>Routing</h1><p>Alpha</p></main>",
        )
        .unwrap();
        fs::write(dir.join("404.html"), "<main>Not indexed</main>").unwrap();
        assert_eq!(build(&dir, &out, "main").unwrap(), 1);
        let old: Value =
            serde_json::from_slice(&fs::read(out.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(
            read_index(out.to_str().unwrap()).unwrap()["docs"][0]["title"],
            "Routing"
        );
        fs::write(
            dir.join("index.html"),
            "<main data-otf-search-body><h1>Routing</h1><p>Beta</p></main>",
        )
        .unwrap();
        build(&dir, &out, "main").unwrap();
        let new: Value =
            serde_json::from_slice(&fs::read(out.join("manifest.json")).unwrap()).unwrap();
        assert_ne!(old["fragmentsDir"], new["fragmentsDir"]);
        let old_file = out
            .join(old["fragmentsDir"].as_str().unwrap())
            .join("0.json");
        assert!(fs::read_to_string(old_file).unwrap().contains("Alpha"));
        fs::remove_dir_all(dir).unwrap();
    }
}
