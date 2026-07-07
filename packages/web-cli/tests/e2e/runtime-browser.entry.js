// Browser bundle entry for the hi-fi runtime suite. Importing each `*.browser.js` file runs
// its top-level describe/test calls, registering them with the in-page runner
// (packages/web-test/browser-runner.js), which exposes `window.__run()`. The orchestrator
// (runtime-browser.mjs) bundles this for the browser, loads it in Chromium, and runs it.

import "../../../web/runtime/dom.browser.js";
import "../../../web/runtime/events.browser.js";
import "../../../web/runtime/hydrate.browser.js";
import "../../../web/runtime/context.browser.js";
import "../../../web/runtime/portal.browser.js";
import "../../../web/runtime/error-boundary.browser.js";
