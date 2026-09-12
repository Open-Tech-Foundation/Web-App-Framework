// Post-build OTF Search indexing for the docs site (Phase 1).
//
// Runs after the SSG pre-render, over the built HTML in `dist/`. Pagefind reads the
// `data-pagefind-body` region of each page (the docs `<main id="otfw-content">`) and
// writes a static, fragmented search index to `dist/pagefind/`. The runtime `<Search>`
// modal loads `/pagefind/pagefind.js` on demand and queries that index — no server.
//
// `@opentf/web-cli` calls this from `otfw build --ssg` when the project's docs config
// has `search.provider === "pagefind"`, keeping all docs build logic owned by web-docs.

import { dirname, join } from "runtime:path";
import { Command } from "runtime:system";

/**
 * Build the Phase-1 JSON index with the internal Rust binary next to `otfwc`.
 * Published toolchains will ship the two binaries together; source checkouts get both
 * from `cargo build -p otfw_cli`.
 */
export async function indexWithOtfSearch({ siteDir, otfwc }) {
  const binary = join(dirname(otfwc), "otf-search");
  const out = new Command(binary, {
    args: ["build", siteDir, "--out", join(siteDir, "_search"), "--root", "main"],
    stdout: "piped",
    stderr: "piped",
    inheritEnv: true,
  });
  const result = await out.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr).trim() || "otf-search failed");
  const message = new TextDecoder().decode(result.stderr);
  const pages = Number(/indexed\s+(\d+)\s+page/.exec(message)?.[1] ?? 0);
  return { pages };
}
