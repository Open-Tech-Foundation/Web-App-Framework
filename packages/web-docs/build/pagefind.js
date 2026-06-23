// Post-build Pagefind indexing for the docs site (Phase 2 search).
//
// Runs after the SSG pre-render, over the built HTML in `dist/`. Pagefind reads the
// `data-pagefind-body` region of each page (the docs `<main id="otfw-content">`) and
// writes a static, fragmented search index to `dist/pagefind/`. The runtime `<Search>`
// modal loads `/pagefind/pagefind.js` on demand and queries that index — no server.
//
// `@opentf/web-cli` calls this from `otfw build --ssg` when the project's docs config
// has `search.provider === "pagefind"`, keeping all docs build logic owned by web-docs.

/**
 * Index a built site directory with Pagefind.
 * @param {{ siteDir: string }} opts  `siteDir` is the SSG output (e.g. `dist`).
 * @returns {Promise<{ pages: number, errors: string[] }>}
 */
export async function indexWithPagefind({ siteDir }) {
  // Lazy import so the (native) Pagefind binary is only loaded when search is enabled.
  const pagefind = await import("pagefind");
  const { index } = await pagefind.createIndex();
  const added = await index.addDirectory({ path: siteDir });
  await index.writeFiles({ outputPath: `${siteDir}/pagefind` });
  await pagefind.close();
  return { pages: added.page_count, errors: added.errors || [] };
}
