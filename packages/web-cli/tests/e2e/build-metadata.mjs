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
//   bun packages/web-cli/tests/e2e/build-metadata.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides).

import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLI = ROOT + "packages/web-cli/src/cli.js";
const FIXTURE = HERE + "fixture";
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const BASE = "https://example.com";

let passed = 0;
const ok = (label) => (passed++, console.log(`  ✓ ${label}`));
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  ok(label);
}

// The inner HTML of <head> — assertions target head tags, not body markup.
const headOf = (html) => (html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "");

function cleanFixture() {
  for (const d of ["dist", ".otfw", ".otfw-ssg", ".otfw-csr-head", ".otfw-api", ".otfw-api-build", ".otfw-loaders", ".otfw-loaders-build", ".dev"]) {
    rmSync(`${FIXTURE}/${d}`, { recursive: true, force: true });
  }
}

async function build(args) {
  const proc = Bun.spawn(["bun", CLI, "build", ...args], {
    cwd: FIXTURE,
    env: { ...process.env, OTFWC_BIN: OTFWC },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

async function main() {
  cleanFixture();
  try {
    // ── 1. Plain CSR: root layout metadata injected into the single shell ─────────
    const csr = await build([`--base-url=${BASE}`]);
    if (csr.code !== 0) throw new Error(`build (CSR) exited ${csr.code}:\n${csr.out}\n${csr.err}`);
    ok("otfw build (CSR) completes");

    const csrHead = headOf(readFileSync(`${FIXTURE}/dist/index.html`, "utf8"));
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
    assert(!existsSync(`${FIXTURE}/dist/about/index.html`), "CSR build does not pre-render /about");

    // ── 2. SSG: full per-route head (page title/canonical + inherited layout links) ─
    cleanFixture();
    const ssg = await build(["--ssg", `--base-url=${BASE}`]);
    if (ssg.code !== 0) throw new Error(`build --ssg exited ${ssg.code}:\n${ssg.out}\n${ssg.err}`);
    ok("otfw build --ssg completes");

    const aboutHead = headOf(readFileSync(`${FIXTURE}/dist/about/index.html`, "utf8"));
    assert(aboutHead.includes("<title>About — E2E</title>"), "SSG /about uses the page generateMetadata title");
    assert(
      aboutHead.includes(`<link rel="canonical" href="${BASE}/about">`),
      "SSG /about gets a per-route canonical",
    );
    assert(
      aboutHead.includes(`<link rel="alternate" type="application/rss+xml" href="${BASE}/rss.xml">`),
      "SSG /about inherits the layout feed alternate with links[].type",
    );

    console.log(`\n✓ otfw build metadata e2e — ${passed} assertions passed\n`);
  } finally {
    cleanFixture();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e?.message ?? e}\n`);
  process.exit(1);
});
