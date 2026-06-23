// Post-build Pagefind indexing for the docs site (Phase 2 search).
//
// Runs after the SSG pre-render, over the built HTML in `dist/`. Pagefind reads the
// `data-pagefind-body` region of each page (the docs `<main id="otfw-content">`) and
// writes a static, fragmented search index to `dist/pagefind/`. The runtime `<Search>`
// modal loads `/pagefind/pagefind.js` on demand and queries that index — no server.
//
// `@opentf/web-cli` calls this from `otfw build --ssg` when the project's docs config
// has `search.provider === "pagefind"`, keeping all docs build logic owned by web-docs.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/** Recursively collect every `*.html` file under `dir` (absolute paths). */
async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

/**
 * Index a built site directory with Pagefind, file by file so callers can show
 * progress. Only pages that opted into search (`data-pagefind-body`, the docs shell)
 * are added — matching Pagefind's site-wide body-exclusion rule deterministically.
 *
 * @param {{ siteDir: string, onProgress?: (done: number, total: number) => void }} opts
 * @returns {Promise<{ pages: number, errors: string[] }>}
 */
export async function indexWithPagefind({ siteDir, onProgress }) {
  // Lazy import so the (native) Pagefind binary is only loaded when search is enabled.
  const pagefind = await import("pagefind");
  const { index } = await pagefind.createIndex();

  // Pick the searchable pages up front so progress has a real total.
  const pages = [];
  for (const path of await htmlFiles(siteDir)) {
    const content = await readFile(path, "utf8");
    if (content.includes("data-pagefind-body")) pages.push({ path, content });
  }

  const total = pages.length;
  const errors = [];
  let done = 0;
  onProgress?.(0, total);
  for (const { path, content } of pages) {
    const res = await index.addHTMLFile({ sourcePath: relative(siteDir, path), content });
    if (res.errors && res.errors.length) errors.push(...res.errors);
    onProgress?.(++done, total);
  }

  await index.writeFiles({ outputPath: join(siteDir, "pagefind") });
  await pagefind.close();
  return { pages: total, errors };
}
