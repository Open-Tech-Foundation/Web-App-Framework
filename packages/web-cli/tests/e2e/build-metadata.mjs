// End-to-end test for Metadata & SEO under `otfw build` (docs/routing/metadata).
// Runs the real CLI against the fixture app and asserts how `<head>` is composed in
// both build modes:
//
//   1. Plain CSR (`otfw build`, no --ssg): one index.html shell serves every route, so
//      only the root layout's *route-independent* metadata is injected — favicon/other
//      links (incl. links[].type), site-wide description, Open Graph site defaults — and
//      never a per-page title or canonical.
//   2. SSG (`otfw build --ssg`): each route gets a full per-route <head> — the page's
//      title/canonical plus the inherited layout links (again incl. links[].type).
//
//   esdev packages/web-cli/tests/e2e/build-metadata.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build
// (OTFWC_BIN overrides).

import { assert, cleanFixture, cliRun, exists, HERE, ok, readText, run } from "./lib.js";

const FIXTURE = `${HERE}/fixture`;
const BASE = "https://example.com";

// The inner HTML of <head> — assertions target head tags, not body markup.
const headOf = (html) => (html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "");

const build = (args) => cliRun(["build", ...args], { root: FIXTURE });

async function main() {
  await cleanFixture(FIXTURE);
  try {
    // ── 1. Plain CSR: root layout metadata injected into the single shell ─────────
    const csr = await build([`--base-url=${BASE}`]);
    if (csr.code !== 0) throw new Error(`build (CSR) exited ${csr.code}:\n${csr.out}\n${csr.err}`);
    ok("otfw build (CSR) completes");

    const csrHead = headOf(await readText(`${FIXTURE}/dist/index.html`));
    assert(
      csrHead.includes(`<link rel="icon" href="${BASE}/favicon.svg">`),
      "CSR shell gets the layout favicon link (absolutized)",
    );
    assert(
      csrHead.includes(`<link rel="alternate" type="application/rss+xml" href="${BASE}/rss.xml">`),
      "CSR shell emits links[].type on the feed alternate",
    );
    assert(
      csrHead.includes(`<meta name="description" content="E2E fixture site.">`),
      "CSR shell gets the site-wide layout description",
    );
    assert(
      csrHead.includes(`<meta property="og:site_name" content="E2E Fixture">`),
      "CSR shell gets the Open Graph site default",
    );
    // Route-independent: the shared shell must not claim one route's canonical/title.
    assert(!csrHead.includes("rel=\"canonical\""), "CSR shell has no route-specific canonical");
    assert(csrHead.includes("<title>E2E Fixture</title>"), "CSR shell keeps its own <title> (no per-page title leaks)");
    // CSR does not pre-render per-route HTML.
    assert(!await exists(`${FIXTURE}/dist/about/index.html`), "CSR build does not pre-render /about");

    // ── 2. SSG: full per-route head (page title/canonical + inherited layout links) ─
    await cleanFixture(FIXTURE);
    const ssg = await build(["--ssg", `--base-url=${BASE}`]);
    if (ssg.code !== 0) throw new Error(`build --ssg exited ${ssg.code}:\n${ssg.out}\n${ssg.err}`);
    ok("otfw build --ssg completes");

    const aboutHead = headOf(await readText(`${FIXTURE}/dist/about/index.html`));
    assert(aboutHead.includes("<title>About — E2E</title>"), "SSG /about uses the page generateMetadata title");
    assert(
      aboutHead.includes(`<link rel="canonical" href="${BASE}/about">`),
      "SSG /about gets a per-route canonical",
    );
    assert(
      aboutHead.includes(`<link rel="alternate" type="application/rss+xml" href="${BASE}/rss.xml">`),
      "SSG /about inherits the layout feed alternate with links[].type",
    );

  } finally {
    await cleanFixture(FIXTURE);
  }
}

await run("otfw build metadata e2e", main);
