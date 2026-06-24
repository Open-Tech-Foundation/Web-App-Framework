//! Module graph — the "graph arc" (ARCHITECTURE.md §5.2 / §4.6).
//!
//! A standalone crawl of an app's modules: nodes = resolved module files, edges =
//! import dependencies (static `import` / `export … from` plus dynamic `import()`).
//! Each node carries a content fingerprint (§5.3), so the toolchain can answer —
//! without re-parsing the world —
//!
//!   - **what a route needs**: its transitive dependency subgraph, so a request can
//!     compile only what it touches (lazy / on-demand compilation), and
//!   - **what a change affects**: the transitive dependents of an edited file, so a
//!     rebuild recompiles precisely those and nothing else.
//!
//! This is the structure the Rust orchestrator (§8) owns and that Rolldown is meant
//! to consume rather than re-derive. Resolution here is an interim resolver for
//! app-local modules plus the `@opentf/web` alias; bare npm specifiers are recorded
//! as external leaf edges (Rolldown owns their resolution and bundling).
//!
//! Status: foundation. Environment tagging (§5.2's `client`/`server`/`shared`) is
//! present in the type but every node defaults to `Shared` until directive/boundary
//! analysis lands.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::{Path, PathBuf};

use oxc::ast::ast::{
    ExportAllDeclaration, ExportNamedDeclaration, Expression, ImportDeclaration, ImportExpression,
    Program,
};
use oxc::ast_visit::{walk, Visit};

use crate::mdx::mdx_to_jsx;
use crate::parse::ParseSession;

/// A module's identity: its normalized (lexically resolved) absolute file path.
/// External specifiers that we don't resolve keep their specifier string verbatim.
pub type ModuleId = String;

/// Where a module runs. Drives the client/server split and code-splitting (§5.2).
/// Classification is future work; everything is `Shared` for now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Client,
    Server,
    Shared,
}

/// One dependency edge out of a module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportEdge {
    /// The specifier exactly as written (`"./foo.jsx"`, `"@opentf/web"`).
    pub specifier: String,
    /// The resolved target's `ModuleId`, or the specifier itself when external.
    pub target: ModuleId,
    /// `import()` (a lazy split point) rather than a static `import`/`export … from`.
    pub dynamic: bool,
    /// A bare/unresolved specifier (npm, or a path we don't own) — a graph leaf.
    pub external: bool,
}

/// A resolved module and its outgoing edges.
#[derive(Debug, Clone)]
pub struct ModuleNode {
    pub id: ModuleId,
    /// 16-hex FNV-1a fingerprint of the module's raw source (§5.3); empty for
    /// external nodes (whose contents we don't read).
    pub fingerprint: String,
    pub environment: Environment,
    pub external: bool,
    pub deps: Vec<ImportEdge>,
}

/// The crawled graph. `nodes` is keyed (and ordered) by `ModuleId` so dumps and
/// query results are deterministic.
#[derive(Debug, Default)]
pub struct ModuleGraph {
    pub nodes: BTreeMap<ModuleId, ModuleNode>,
}

/// A read-only view of the filesystem, so the crawl is hermetic and testable.
pub trait Vfs {
    fn read(&self, path: &Path) -> Option<String>;
    fn exists(&self, path: &Path) -> bool;
}

/// The real filesystem.
pub struct DiskVfs;

impl Vfs for DiskVfs {
    fn read(&self, path: &Path) -> Option<String> {
        std::fs::read_to_string(path).ok()
    }
    fn exists(&self, path: &Path) -> bool {
        path.is_file()
    }
}

/// Import resolution config: extensions to try and specifier→file aliases (e.g.
/// `@opentf/web` → the runtime's entry file). Mirrors the dev server's Rolldown
/// `resolve` so the graph and the bundler agree on app-local modules.
pub struct Resolver {
    pub alias: BTreeMap<String, PathBuf>,
    pub extensions: Vec<String>,
}

impl Resolver {
    /// A resolver matching the toolchain defaults: the standard extension list and a
    /// single `@opentf/web` alias to the runtime entry.
    pub fn new(web_entry: PathBuf) -> Self {
        let mut alias = BTreeMap::new();
        alias.insert("@opentf/web".to_string(), web_entry);
        Self {
            alias,
            extensions: [".jsx", ".tsx", ".js", ".ts", ".mdx", ".md"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        }
    }

    /// Resolve `specifier` imported from `importer_dir`. Relative specifiers resolve
    /// against the directory (with extension / `index` probing); an aliased
    /// specifier resolves to its target; everything else (bare npm) is external.
    pub fn resolve(&self, specifier: &str, importer_dir: &Path, vfs: &dyn Vfs) -> Option<PathBuf> {
        // Absolute path (the dev entry's route loaders are `import("/abs/page.jsx")`).
        if specifier.starts_with('/') {
            return self.resolve_file(Path::new(specifier), vfs);
        }
        if specifier.starts_with("./") || specifier.starts_with("../") {
            return self.resolve_file(&importer_dir.join(specifier), vfs);
        }
        if let Some(target) = self.alias.get(specifier) {
            return self.resolve_file(target, vfs);
        }
        None
    }

    /// Probe a path: exact file, then `path + ext`, then `path/index + ext`.
    fn resolve_file(&self, candidate: &Path, vfs: &dyn Vfs) -> Option<PathBuf> {
        let norm = normalize(candidate);
        if vfs.exists(&norm) {
            return Some(norm);
        }
        for ext in &self.extensions {
            let p = PathBuf::from(format!("{}{ext}", norm.to_string_lossy()));
            if vfs.exists(&p) {
                return Some(p);
            }
        }
        for ext in &self.extensions {
            let p = normalize(&norm.join(format!("index{ext}")));
            if vfs.exists(&p) {
                return Some(p);
            }
        }
        None
    }
}

impl ModuleGraph {
    /// Crawl outward from `entries`, parsing each module, resolving its imports, and
    /// recording nodes + edges + fingerprints. Unreadable or unparseable modules are
    /// recorded as empty (dependency-free) nodes so the graph stays total.
    pub fn build(entries: &[PathBuf], resolver: &Resolver, vfs: &dyn Vfs) -> ModuleGraph {
        let mut graph = ModuleGraph::default();
        let mut queue: VecDeque<PathBuf> = entries.iter().map(|p| normalize(p)).collect();
        let mut seen: BTreeSet<ModuleId> = BTreeSet::new();

        while let Some(path) = queue.pop_front() {
            let id: ModuleId = path.to_string_lossy().into_owned();
            if !seen.insert(id.clone()) {
                continue;
            }

            let Some(source) = vfs.read(&path) else {
                continue; // a missing entry — leave it out rather than inventing a node
            };
            let fingerprint = fingerprint(&source);

            // `.mdx`/`.md` aren't valid JS: lower to JSX (which hoists the ESM
            // imports) before parsing. The fingerprint stays over the raw source.
            let to_parse = if is_mdx(&path) {
                mdx_to_jsx(&source, &id).unwrap_or_default()
            } else {
                source
            };

            let session = ParseSession::new();
            let parsed = session.parse(&path, &to_parse);
            let dir = path.parent().unwrap_or_else(|| Path::new("")).to_path_buf();

            let mut deps = Vec::new();
            for (specifier, dynamic) in collect_imports(&parsed.program) {
                match resolver.resolve(&specifier, &dir, vfs) {
                    Some(target) => {
                        let target_id = target.to_string_lossy().into_owned();
                        deps.push(ImportEdge {
                            specifier,
                            target: target_id,
                            dynamic,
                            external: false,
                        });
                        queue.push_back(target);
                    }
                    None => deps.push(ImportEdge {
                        specifier: specifier.clone(),
                        target: specifier,
                        dynamic,
                        external: true,
                    }),
                }
            }

            graph.nodes.insert(
                id.clone(),
                ModuleNode {
                    id,
                    fingerprint,
                    environment: Environment::Shared,
                    external: false,
                    deps,
                },
            );
        }

        graph
    }

    /// Modules reachable from `root` (inclusive). With `follow_dynamic = false` the
    /// walk stops at `import()` boundaries — i.e. it returns exactly `root`'s own
    /// chunk (a route's static dependency set), which is the unit to compile on
    /// demand. With `true` it returns the whole reachable closure.
    pub fn subgraph(&self, root: &str, follow_dynamic: bool) -> BTreeSet<ModuleId> {
        let mut out = BTreeSet::new();
        let mut queue = VecDeque::new();
        if self.nodes.contains_key(root) {
            queue.push_back(root.to_string());
        }
        while let Some(id) = queue.pop_front() {
            if !out.insert(id.clone()) {
                continue;
            }
            let Some(node) = self.nodes.get(&id) else { continue };
            for edge in &node.deps {
                if edge.external || (edge.dynamic && !follow_dynamic) {
                    continue;
                }
                if !out.contains(&edge.target) {
                    queue.push_back(edge.target.clone());
                }
            }
        }
        out
    }

    /// Modules that transitively import `changed` (inclusive) — the rebuild set when
    /// `changed`'s fingerprint moves. Walks edges in reverse, crossing dynamic
    /// boundaries (a lazy importer still needs rebuilding when its dependency does).
    pub fn affected(&self, changed: &str) -> BTreeSet<ModuleId> {
        // Reverse adjacency: target → importers.
        let mut importers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for node in self.nodes.values() {
            for edge in &node.deps {
                if !edge.external {
                    importers.entry(edge.target.as_str()).or_default().push(node.id.as_str());
                }
            }
        }
        let mut out = BTreeSet::new();
        let mut queue = VecDeque::new();
        queue.push_back(changed.to_string());
        while let Some(id) = queue.pop_front() {
            if !out.insert(id.clone()) {
                continue;
            }
            for &importer in importers.get(id.as_str()).map(Vec::as_slice).unwrap_or(&[]) {
                if !out.contains(importer) {
                    queue.push_back(importer.to_string());
                }
            }
        }
        out
    }
}

/// FNV-1a over the source bytes → 16 hex chars (the full 64-bit digest; wide enough
/// to be a cache key, unlike the 32-bit module-id tags in `codegen::tags`).
fn fingerprint(source: &str) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x100_0000_01b3;
    let mut h = OFFSET;
    for b in source.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(PRIME);
    }
    format!("{h:016x}")
}

fn is_mdx(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()), Some("mdx") | Some("md"))
}

/// Lexically normalize a path (resolve `.` / `..`, collapse `//`) without touching
/// the filesystem, so two specifiers for the same file share one `ModuleId`. Posix
/// separators — the toolchain's module ids are `/`-delimited.
fn normalize(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let absolute = s.starts_with('/');
    let mut stack: Vec<&str> = Vec::new();
    for seg in s.split('/') {
        match seg {
            "" | "." => {}
            ".." => match stack.last() {
                Some(&last) if last != ".." => {
                    stack.pop();
                }
                _ => {
                    if !absolute {
                        stack.push("..");
                    }
                }
            },
            other => stack.push(other),
        }
    }
    let mut out = String::new();
    if absolute {
        out.push('/');
    }
    out.push_str(&stack.join("/"));
    PathBuf::from(out)
}

/// Collect every dependency specifier in a module: static `import`, re-exporting
/// `export … from`, `export * from`, and dynamic `import("literal")`. Dynamic
/// imports with a non-literal argument can't be resolved statically and are skipped.
fn collect_imports(program: &Program) -> Vec<(String, bool)> {
    let mut collector = ImportCollector { imports: Vec::new() };
    collector.visit_program(program);
    collector.imports
}

struct ImportCollector {
    /// `(specifier, dynamic)` in source order.
    imports: Vec<(String, bool)>,
}

impl<'a> Visit<'a> for ImportCollector {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        self.imports.push((it.source.value.to_string(), false));
    }

    fn visit_export_named_declaration(&mut self, it: &ExportNamedDeclaration<'a>) {
        if let Some(source) = &it.source {
            self.imports.push((source.value.to_string(), false));
        }
        walk::walk_export_named_declaration(self, it);
    }

    fn visit_export_all_declaration(&mut self, it: &ExportAllDeclaration<'a>) {
        self.imports.push((it.source.value.to_string(), false));
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Expression::StringLiteral(s) = &it.source {
            self.imports.push((s.value.to_string(), true));
        }
        walk::walk_import_expression(self, it);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// In-memory VFS: a path → contents map, so crawl tests are hermetic.
    struct MapVfs {
        files: BTreeMap<String, String>,
    }
    impl MapVfs {
        fn new(files: &[(&str, &str)]) -> Self {
            Self {
                files: files.iter().map(|(p, c)| (p.to_string(), c.to_string())).collect(),
            }
        }
    }
    impl Vfs for MapVfs {
        fn read(&self, path: &Path) -> Option<String> {
            self.files.get(&path.to_string_lossy().into_owned()).cloned()
        }
        fn exists(&self, path: &Path) -> bool {
            self.files.contains_key(&path.to_string_lossy().into_owned())
        }
    }

    fn resolver() -> Resolver {
        Resolver::new(PathBuf::from("/node_modules/@opentf/web/index.js"))
    }

    #[test]
    fn normalize_resolves_dot_segments() {
        assert_eq!(normalize(Path::new("/app/docs/../page.jsx")), PathBuf::from("/app/page.jsx"));
        assert_eq!(normalize(Path::new("/app/./a//b.jsx")), PathBuf::from("/app/a/b.jsx"));
        assert_eq!(normalize(Path::new("../x.jsx")), PathBuf::from("../x.jsx"));
    }

    #[test]
    fn fingerprint_is_stable_and_content_sensitive() {
        assert_eq!(fingerprint("hello"), fingerprint("hello"));
        assert_ne!(fingerprint("hello"), fingerprint("hello!"));
        assert_eq!(fingerprint("hello").len(), 16);
    }

    #[test]
    fn collects_static_dynamic_and_reexport_specifiers() {
        let session = ParseSession::new();
        let src = r#"
            import { mountApp } from "@opentf/web";
            import Layout from "./layout.jsx";
            export { default as A } from "./a.jsx";
            export * from "./b.jsx";
            const routes = { "/": () => import("./page.jsx") };
        "#;
        let parsed = session.parse(Path::new("entry.js"), src);
        let imports = collect_imports(&parsed.program);
        assert!(imports.contains(&("@opentf/web".to_string(), false)));
        assert!(imports.contains(&("./layout.jsx".to_string(), false)));
        assert!(imports.contains(&("./a.jsx".to_string(), false)));
        assert!(imports.contains(&("./b.jsx".to_string(), false)));
        assert!(imports.contains(&("./page.jsx".to_string(), true)), "dynamic import: {imports:?}");
    }

    #[test]
    fn resolves_relative_with_extension_and_index() {
        let vfs = MapVfs::new(&[
            ("/app/page.jsx", ""),
            ("/app/widgets/index.jsx", ""),
        ]);
        let r = resolver();
        assert_eq!(
            r.resolve("./page", Path::new("/app"), &vfs),
            Some(PathBuf::from("/app/page.jsx")),
        );
        assert_eq!(
            r.resolve("./widgets", Path::new("/app"), &vfs),
            Some(PathBuf::from("/app/widgets/index.jsx")),
        );
        assert_eq!(r.resolve("react", Path::new("/app"), &vfs), None); // bare → external
    }

    #[test]
    fn builds_graph_and_answers_subgraph_and_affected() {
        // entry → (static) framework + layout; entry → (dynamic) page → card.
        let vfs = MapVfs::new(&[
            ("/node_modules/@opentf/web/index.js", "export const mountApp = 0;"),
            (
                "/app/entry.js",
                r#"import { mountApp } from "@opentf/web";
                   import "some-npm-pkg";
                   import "./layout.jsx";
                   const r = () => import("./page.jsx");"#,
            ),
            ("/app/layout.jsx", r#"import "@opentf/web";"#),
            ("/app/page.jsx", r#"import "./card.jsx"; import "@opentf/web";"#),
            ("/app/card.jsx", r#"import "@opentf/web";"#),
        ]);
        let graph = ModuleGraph::build(&[PathBuf::from("/app/entry.js")], &resolver(), &vfs);

        // Every internal module was discovered (crawl crossed the dynamic edge).
        for id in ["/app/entry.js", "/app/layout.jsx", "/app/page.jsx", "/app/card.jsx"] {
            assert!(graph.nodes.contains_key(id), "missing {id}");
        }
        // The aliased framework specifier resolves to a real file: internal + crawled.
        assert!(graph.nodes.contains_key("/node_modules/@opentf/web/index.js"));
        let entry = &graph.nodes["/app/entry.js"];
        assert!(entry.deps.iter().any(|e| e.specifier == "@opentf/web" && !e.external));
        // A bare npm specifier with no alias is an external leaf edge, never a node.
        assert!(!graph.nodes.contains_key("some-npm-pkg"));
        assert!(entry.deps.iter().any(|e| e.specifier == "some-npm-pkg" && e.external));

        // The entry's own chunk stops at the dynamic `import("./page.jsx")` boundary.
        let chunk = graph.subgraph("/app/entry.js", false);
        assert!(chunk.contains("/app/entry.js"));
        assert!(chunk.contains("/app/layout.jsx"));
        assert!(!chunk.contains("/app/page.jsx"), "dynamic dep must not be in the entry chunk");

        // The route's chunk is page + its static deps.
        let route = graph.subgraph("/app/page.jsx", false);
        assert!(route.contains("/app/page.jsx") && route.contains("/app/card.jsx"));

        // Editing card.jsx affects card → page (its importer), but not the unrelated layout.
        let hit = graph.affected("/app/card.jsx");
        assert!(hit.contains("/app/card.jsx") && hit.contains("/app/page.jsx"));
        assert!(!hit.contains("/app/layout.jsx"));
    }

    #[test]
    fn crawls_mdx_imports() {
        let vfs = MapVfs::new(&[
            ("/node_modules/@opentf/web/index.js", ""),
            ("/app/cmp.jsx", ""),
            (
                "/app/page.mdx",
                "import Cmp from \"./cmp.jsx\";\n\n# Hi\n\n<Cmp />\n",
            ),
        ]);
        let graph = ModuleGraph::build(&[PathBuf::from("/app/page.mdx")], &resolver(), &vfs);
        let page = &graph.nodes["/app/page.mdx"];
        assert!(
            page.deps.iter().any(|e| e.specifier == "./cmp.jsx" && !e.external),
            "mdx import not crawled: {:?}",
            page.deps,
        );
        assert!(graph.nodes.contains_key("/app/cmp.jsx"));
    }
}
