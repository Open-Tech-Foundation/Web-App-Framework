// End-to-end test for route loaders under `otfw build --ssg` (docs/DATA.md): the
// static-hosting story. Runs the real CLI build against the fixture app and
// asserts that every loader page gets (a) its data server-rendered into the
// prerendered HTML, (b) the inline `#__otfw_data` payload, and (c) a literal
// sibling `__data.json` file — the same URL SPA navigation fetches, so a plain
// static host serves it with no server at all.
//
//   bun packages/web-cli/tests/e2e/build-data.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides).

import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CLI = ROOT + "packages/web-cli/src/cli.js";
const FIXTURE = HERE + "fixture";
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";

let passed = 0;
const ok = (label) => (passed++, console.log(`  ✓ ${label}`));
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  ok(label);
}

// SSG markup interleaves hydration markers (`todo <!--$-->alpha<!--/-->`); strip
// them so assertions can match the text a browser would show.
const visibleText = (html) => html.replace(/<!--[^>]*-->/g, "");

function cleanFixture() {
  for (const d of ["dist", ".otfw", ".otfw-ssg", ".otfw-api", ".otfw-api-build", ".otfw-loaders", ".otfw-loaders-build", ".dev"]) {
    rmSync(`${FIXTURE}/${d}`, { recursive: true, force: true });
  }
}

async function main() {
  cleanFixture();

  const proc = Bun.spawn(["bun", CLI, "build", "--ssg", "--base-url=https://example.com"], {
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
  try {
    if (code !== 0) throw new Error(`build --ssg exited ${code}:\n${out}\n${err}`);
    ok("otfw build --ssg completes");

    // ── 1. The loader bundle is emitted for `otfw serve` / deploy adapters ──────
    assert(existsSync(`${FIXTURE}/dist/server/loaders.js`), "dist/server/loaders.js is emitted");

    // ── 2. Static loader pages: SSR'd data + inline payload + sibling data file ─
    const todosHtml = readFileSync(`${FIXTURE}/dist/todos/index.html`, "utf8");
    assert(visibleText(todosHtml).includes("todo alpha"), "dist/todos/index.html carries the loader's rendered data");
    const payload = todosHtml.match(/<script type="application\/json" id="__otfw_data">([\s\S]*?)<\/script>/);
    assert(!!payload, "dist/todos/index.html inlines the __otfw_data payload");
    assert(JSON.parse(payload[1]).items[1] === "beta", "the inline payload parses to the loader data");

    const dataFile = `${FIXTURE}/dist/todos/__data.json`;
    assert(existsSync(dataFile), "dist/todos/__data.json is written next to the page");
    const data = JSON.parse(readFileSync(dataFile, "utf8"));
    assert(data.items[0] === "alpha", "the static data file parses to the loader data");
    assert(data.q === null, "SSG runs the loader with an empty query (q is null)");

    // ── 3. Dynamic routes expand via getStaticPaths, loader params flowing in ───
    const itemHtml = readFileSync(`${FIXTURE}/dist/items/7/index.html`, "utf8");
    assert(visibleText(itemHtml).includes("ITEM 7"), "dist/items/7/index.html renders the loader's param data");
    assert(existsSync(`${FIXTURE}/dist/items/7/__data.json`), "dist/items/7/__data.json is written");
    assert(
      JSON.parse(readFileSync(`${FIXTURE}/dist/items/7/__data.json`, "utf8")).id === "7",
      "the dynamic route's data file carries its params-derived data",
    );

    // ── 4. Loader-less pages are untouched; a throwing loader fails only its page ─
    const aboutHtml = readFileSync(`${FIXTURE}/dist/about/index.html`, "utf8");
    assert(!aboutHtml.includes("__otfw_data"), "a loader-less page gets no data payload");
    assert(!existsSync(`${FIXTURE}/dist/about/__data.json`), "a loader-less page gets no data file");
    assert(!existsSync(`${FIXTURE}/dist/__data.json`), "no root data file without a root loader");
    assert(!existsSync(`${FIXTURE}/dist/boom/index.html`), "a throwing loader fails its page's prerender");
    assert(/pre-render failed for \/boom/.test(out + err), "the /boom failure is reported");
    const homeHtml = readFileSync(`${FIXTURE}/dist/index.html`, "utf8");
    assert(homeHtml.includes("E2E_HOME"), "the rest of the build is unaffected (home prerendered)");

    console.log(`\n✓ otfw build --ssg loader e2e — ${passed} assertions passed\n`);
  } finally {
    cleanFixture();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e?.message ?? e}\n`);
  process.exit(1);
});
