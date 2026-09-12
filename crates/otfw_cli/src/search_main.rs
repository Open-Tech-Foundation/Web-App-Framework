//! Internal Phase-1 static-search indexer for `@opentf/web-docs`.
//!
//! The JSON format here is intentionally temporary. It proves extraction, stable
//! document IDs, and reader behaviour before the binary/chunked format lands.

use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, process::ExitCode};
use lol_html::{doc_text, element, HtmlRewriter, Settings};
use serde_json::{json, Value};
use unicode_segmentation::UnicodeSegmentation;
use walkdir::WalkDir;

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("build") => build_cmd(&args),
        Some("inspect") => inspect_cmd(&args),
        Some("query") => query_cmd(&args),
        _ => { eprintln!("usage: otf-search <build|inspect|query> …"); ExitCode::FAILURE },
    }
}

fn build_cmd(args: &[String]) -> ExitCode {
    let Some(site) = args.get(1) else { eprintln!("otf-search: missing export directory"); return ExitCode::FAILURE; };
    let mut out = PathBuf::from(site).join("_search");
    let mut root = "main".to_string();
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => { i += 1; if let Some(value) = args.get(i) { out = PathBuf::from(value); } },
            "--root" => { i += 1; if let Some(value) = args.get(i) { root = value.clone(); } },
            flag => { eprintln!("otf-search: unknown option {flag}"); return ExitCode::FAILURE; },
        }
        i += 1;
    }
    match build(Path::new(site), &out, &root) {
        Ok(count) => { eprintln!("otf-search: indexed {count} page(s) → {}", out.display()); ExitCode::SUCCESS },
        Err(error) => { eprintln!("otf-search: {error}"); ExitCode::FAILURE },
    }
}

fn read_index(dir: &str) -> Result<Value, String> {
    let path = Path::new(dir).join("index.json");
    serde_json::from_slice(&fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?).map_err(|e| e.to_string())
}

fn inspect_cmd(args: &[String]) -> ExitCode {
    let (Some(dir), Some(flag), Some(term)) = (args.get(1), args.get(2), args.get(3)) else { eprintln!("usage: otf-search inspect <index-dir> --term <term>"); return ExitCode::FAILURE; };
    if flag != "--term" { eprintln!("usage: otf-search inspect <index-dir> --term <term>"); return ExitCode::FAILURE; }
    match read_index(dir).and_then(|index| Ok(index["terms"][term.to_lowercase()].clone())) {
        Ok(Value::Null) => { println!("{{\"term\":{},\"df\":0,\"postings\":[]}}", serde_json::to_string(term).unwrap()); ExitCode::SUCCESS }
        Ok(postings) => { println!("{{\"term\":{},\"df\":{},\"postings\":{}}}", serde_json::to_string(term).unwrap(), postings.as_array().map_or(0, Vec::len), postings); ExitCode::SUCCESS }
        Err(error) => { eprintln!("otf-search: {error}"); ExitCode::FAILURE },
    }
}

fn query_cmd(args: &[String]) -> ExitCode {
    let (Some(dir), Some(query)) = (args.get(1), args.get(2)) else { eprintln!("usage: otf-search query <index-dir> <query>"); return ExitCode::FAILURE; };
    let index = match read_index(dir) { Ok(value) => value, Err(error) => { eprintln!("otf-search: {error}"); return ExitCode::FAILURE; } };
    let mut scores: BTreeMap<usize, u64> = BTreeMap::new();
    for term in tokens(query) {
        for posting in index["terms"][term.as_str()].as_array().into_iter().flatten() {
            if let (Some(doc), Some(tf)) = (posting[0].as_u64(), posting[1].as_u64()) { *scores.entry(doc as usize).or_default() += tf; }
        }
    }
    let mut ranked: Vec<_> = scores.into_iter().collect(); ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let results: Vec<_> = ranked.into_iter().take(10).filter_map(|(doc, score)| index["docs"].get(doc).map(|fragment| json!({"url": fragment["url"], "title": fragment["title"], "score": score}))).collect();
    println!("{}", json!({"results": results})); ExitCode::SUCCESS
}

fn build(site: &Path, out: &Path, root: &str) -> Result<usize, String> {
    let mut paths: Vec<PathBuf> = WalkDir::new(site).into_iter().filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.path().extension().is_some_and(|x| x == "html"))
        .map(|entry| entry.into_path()).collect();
    paths.sort(); // Document IDs and output are deterministic.
    let mut terms: BTreeMap<String, BTreeMap<usize, u32>> = BTreeMap::new();
    let mut fragments = Vec::new();
    let mut lengths = Vec::new();
    for (id, path) in paths.iter().enumerate() {
        let html = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let text = extract(&html, root);
        let title = first_tag_text(&html, "h1").or_else(|| first_tag_text(&html, "title")).unwrap_or_else(|| relative_url(site, path));
        let document_tokens = tokens(&text);
        lengths.push(document_tokens.len());
        for token in document_tokens { *terms.entry(token).or_default().entry(id).or_default() += 1; }
        fragments.push(json!({"url": relative_url(site, path), "title": title, "text": text, "meta": {}, "anchors": []}));
    }
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    fs::create_dir_all(out.join("t")).map_err(|e| e.to_string())?;
    let (chunk_bytes, first_term, term_count) = encode_term_chunk(&terms);
    let chunk_hash = blake3::hash(&chunk_bytes).to_hex().to_string()[..12].to_string(); let chunk_file = format!("t/{chunk_hash}.bin");
    fs::write(out.join(&chunk_file), &chunk_bytes).map_err(|e| e.to_string())?;
    let fragments_dir = out.join("f"); fs::create_dir_all(&fragments_dir).map_err(|e| e.to_string())?;
    for (id, fragment) in fragments.into_iter().enumerate() { fs::write(fragments_dir.join(format!("{id}.json")), serde_json::to_vec(&fragment).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?; }
    // Phase 2 migration seam: readers may load this compact table before fetching any
    // postings. The JSON index remains the active fallback until term chunks land.
    let mut docs_bin = Vec::new(); for length in &lengths { write_varint(*length as u64, &mut docs_bin); }
    let docs_hash = blake3::hash(&docs_bin).to_hex().to_string()[..12].to_string();
    let docs_file = format!("docs.{docs_hash}.bin");
    fs::write(out.join(&docs_file), &docs_bin).map_err(|e| e.to_string())?;
    let avgdl = if lengths.is_empty() { 0.0 } else { lengths.iter().sum::<usize>() as f64 / lengths.len() as f64 };
    fs::write(out.join("manifest.json"), serde_json::to_vec(&json!({"v": 1, "docs": lengths.len(), "avgdl": avgdl, "docsFile": docs_file, "chunks": [{"first": first_term, "file": chunk_file, "terms": term_count}]})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(paths.len())
}

fn write_varint(mut value: u64, out: &mut Vec<u8>) { while value >= 0x80 { out.push((value as u8) | 0x80); value >>= 7; } out.push(value as u8); }

fn encode_term_chunk(terms: &BTreeMap<String, BTreeMap<usize, u32>>) -> (Vec<u8>, String, usize) {
    let mut postings = Vec::new(); let mut rows = Vec::new(); let mut previous = Vec::new();
    for (term, docs) in terms {
        let offset = postings.len(); let mut last_doc = 0usize;
        for (&doc, &tf) in docs { write_varint((doc - last_doc) as u64, &mut postings); write_varint(tf as u64, &mut postings); for _ in 0..tf { write_varint(0, &mut postings); } last_doc = doc; }
        let bytes = term.as_bytes(); let common = bytes.iter().zip(previous.iter()).take_while(|(a, b)| a == b).count();
        rows.push((common, bytes[common..].to_vec(), docs.len(), offset)); previous = bytes.to_vec();
    }
    let mut out = b"OTFI".to_vec(); out.push(1); write_varint(rows.len() as u64, &mut out);
    for (prefix, suffix, df, offset) in rows { write_varint(prefix as u64, &mut out); write_varint(suffix.len() as u64, &mut out); out.extend(suffix); write_varint(df as u64, &mut out); write_varint(offset as u64, &mut out); }
    out.extend(postings); (out, terms.keys().next().cloned().unwrap_or_default(), terms.len())
}

fn extract(html: &str, root: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let needle = format!("<{root}");
    let fragment = lower.find(&needle).and_then(|start| lower[start..].find('>').map(|_| &html[start..])).unwrap_or(html);
    let mut cleaned = Vec::new();
    { let mut rewriter = HtmlRewriter::new(Settings::new().append_element_content_handler(element!("script, style, noscript, nav, header, footer, aside, [data-otf-search-ignore]", |el| { el.remove(); Ok(()) })), |chunk: &[u8]| cleaned.extend_from_slice(chunk)); let _ = rewriter.write(fragment.as_bytes()); let _ = rewriter.end(); }
    let mut text = String::new();
    { let mut rewriter = HtmlRewriter::new(Settings::new().append_document_content_handler(doc_text!(|chunk| { text.push_str(chunk.as_str()); if chunk.last_in_text_node() { text.push(' '); } Ok(()) })), |_: &[u8]| {}); let _ = rewriter.write(&cleaned); let _ = rewriter.end(); }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_tag_text(html: &str, tag: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase(); let start = lower.find(&format!("<{tag}"))?; let content = lower[start..].find('>').map(|n| start + n + 1)?; let end = lower[content..].find(&format!("</{tag}"))? + content;
    Some(strip_tags(&html[content..end]).split_whitespace().collect::<Vec<_>>().join(" "))
}
fn strip_tags(value: &str) -> String { let mut out = String::new(); let mut tag = false; for ch in value.chars() { match ch { '<' => tag = true, '>' => tag = false, _ if !tag => out.push(ch), _ => {} } } out }
fn tokens(text: &str) -> Vec<String> { text.unicode_words().map(|word| word.to_lowercase()).filter(|word| !word.is_empty() && word.len() <= 64).collect() }
fn relative_url(site: &Path, path: &Path) -> String { let rel = path.strip_prefix(site).unwrap_or(path).to_string_lossy().replace('\\', "/"); if rel == "index.html" { "/".into() } else { format!("/{}", rel.strip_suffix("index.html").unwrap_or(&rel)) } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_matches_phase_one_vectors() {
        let vectors: Value = serde_json::from_str(include_str!("../../../packages/web-docs/search/tokenizer-vectors.json")).unwrap();
        for vector in vectors.as_array().unwrap() {
            let expected: Vec<String> = vector["tokens"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            assert_eq!(tokens(vector["input"].as_str().unwrap()), expected, "{}", vector["input"]);
        }
    }

    #[test]
    fn extraction_uses_main_and_drops_non_content_regions() {
        let html = r#"<html><head><title>Ignored</title></head><body><header>Header</header><main><h1>Guide</h1><p>Useful <strong>routing</strong> text.</p><aside>Aside</aside><code>route.params</code></main><footer>Footer</footer></body></html>"#;
        assert_eq!(extract(html, "main"), "Guide Useful routing text. route.params");
        assert_eq!(first_tag_text(html, "h1"), Some("Guide".into()));
    }

    #[test]
    fn urls_are_stable_for_index_and_nested_pages() {
        let root = Path::new("/site");
        assert_eq!(relative_url(root, Path::new("/site/index.html")), "/");
        assert_eq!(relative_url(root, Path::new("/site/guide/index.html")), "/guide/");
        assert_eq!(relative_url(root, Path::new("/site/guide/page.html")), "/guide/page.html");
    }
}
