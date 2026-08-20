// End-to-end test for route loaders under `otfw build --ssg` (docs/DATA.md): the
// static-hosting story. Runs the real CLI build against the fixture app and
// asserts that every loader page gets (a) its data server-rendered into the
// prerendered HTML, (b) the inline `#__otfw_data` payload, and (c) a literal
// sibling `__data.json` file — the same URL SPA navigation fetches, so a plain
// static host serves it with no server at all.
//
//   esdev packages/web-cli/tests/e2e/build-data.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build
// (OTFWC_BIN overrides).

import { assert, cleanFixture, cliRun, exists, HERE, ok, readText, run, visibleText } from "./lib.js";

const FIXTURE = `${HERE}/fixture`;

async function main() {
  await cleanFixture(FIXTURE);

  const { code, out, err } = await cliRun(["build", "--ssg", "--base-url=https://example.com"], {
    root: FIXTURE,
  });
  try {
    if (code !== 0) throw new Error(`build --ssg exited ${code}:\n${out}\n${err}`);
    ok("otfw build --ssg completes");

    // ── 1. The loader bundle is emitted for `otfw serve` / deploy adapters ──────
    assert(await exists(`${FIXTURE}/dist/server/loaders.js`), "dist/server/loaders.js is emitted");

    // ── 2. Static loader pages: SSR'd data + inline payload + sibling data file ─
    const todosHtml = await readText(`${FIXTURE}/dist/todos/index.html`);
    assert(visibleText(todosHtml).includes("todo alpha"), "dist/todos/index.html carries the loader's rendered data");
    const payload = todosHtml.match(/<script type="application\/json" id="__otfw_data">([\s\S]*?)<\/script>/);
    assert(!!payload, "dist/todos/index.html inlines the __otfw_data payload");
    assert(JSON.parse(payload[1]).items[1] === "beta", "the inline payload parses to the loader data");

    const dataFile = `${FIXTURE}/dist/todos/__data.json`;
    assert(await exists(dataFile), "dist/todos/__data.json is written next to the page");
    const data = JSON.parse(await readText(dataFile));
    assert(data.items[0] === "alpha", "the static data file parses to the loader data");
    assert(data.q === null, "SSG runs the loader with an empty query (q is null)");

    // ── 3. Dynamic routes expand via getStaticPaths, loader params flowing in ───
    const itemHtml = await readText(`${FIXTURE}/dist/items/7/index.html`);
    assert(visibleText(itemHtml).includes("ITEM 7"), "dist/items/7/index.html renders the loader's param data");
    assert(await exists(`${FIXTURE}/dist/items/7/__data.json`), "dist/items/7/__data.json is written");
    assert(
      JSON.parse(await readText(`${FIXTURE}/dist/items/7/__data.json`)).id === "7",
      "the dynamic route's data file carries its params-derived data",
    );

    // ── 4. Loader-less pages are untouched; a throwing loader fails only its page ─
    const aboutHtml = await readText(`${FIXTURE}/dist/about/index.html`);
    assert(!aboutHtml.includes("__otfw_data"), "a loader-less page gets no data payload");
    assert(!await exists(`${FIXTURE}/dist/about/__data.json`), "a loader-less page gets no data file");
    assert(!await exists(`${FIXTURE}/dist/__data.json`), "no root data file without a root loader");
    assert(!await exists(`${FIXTURE}/dist/boom/index.html`), "a throwing loader fails its page's prerender");
    assert(/pre-render failed for \/boom/.test(out + err), "the /boom failure is reported");
    const homeHtml = await readText(`${FIXTURE}/dist/index.html`);
    assert(homeHtml.includes("E2E_HOME"), "the rest of the build is unaffected (home prerendered)");

  } finally {
    await cleanFixture(FIXTURE);
  }
}

await run("otfw build --ssg loader e2e", main);
