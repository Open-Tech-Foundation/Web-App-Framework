// Hi-fi runtime unit suite, run in a REAL headless browser.
//
// The runtime tests that probe engine-fidelity paths — custom-element upgrade timing, the real
// microtask/event loop, portal relocation, event delegation — live as `packages/web/runtime/
// *.browser.js` (moved out of the `bun test` glob). This orchestrator bundles them for the
// browser, loads the bundle into headless Chromium, and calls the
// in-page runner's `window.__run()`, marshaling the results back over CDP. Everything else
// stays fast under `bun test` + happy-dom.
//
//   esdev packages/web-cli/tests/e2e/runtime-browser.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build (OTFWC_BIN
// overrides) and Chromium (CHROME_BIN overrides; skips cleanly if absent). Exits 0
// only if every test passed.

import { HERE, OTFWC, run } from "./lib.js";
import { bundleForBrowser, connectPage, evalJS, requireCompiler, startBrowser } from "./browser.js";

const ENTRY = `${HERE}/runtime-browser.entry.js`;
const PORT = 9355;

await requireCompiler(OTFWC);

async function main() {
  const code = await bundleForBrowser(ENTRY);
  const chrome = await startBrowser(PORT);
  try {
    const client = await connectPage(PORT);
    await client.send("Runtime.enable");
    // Load the whole suite (runtime + tests + runner) into the page, then run it.
    await evalJS(client, code);
    const results = await evalJS(client, "window.__run()", true);

    let passed = 0;
    const failures = [];
    for (const r of results) {
      if (r.pass) {
        passed++;
      } else {
        failures.push(r);
      }
    }
    for (const f of failures) {
      console.error(`  ✗ ${f.name}\n      ${f.error}`);
    }
    if (client.pageErrors.length) {
      console.error(`  page exceptions:\n    ${client.pageErrors.slice(0, 5).join("\n    ")}`);
    }
    client.close();

    if (failures.length || !results.length) {
      throw new Error(`runtime-browser: ${failures.length} failed / ${results.length} run`);
    }
    console.log(`  ${passed} tests passed in a real browser`);
  } finally {
    chrome.kill();
  }
}

await run("runtime-browser suite", main);
