// Template-cloning parity — the verification pass CSR template cloning rests on.
//
// The CSR backend stamps a static subtree from a hoisted `<template>` instead of
// emitting a `createElement` per node. That is only a legal rewrite because
// `template.innerHTML` runs the HTML *parser*, which restructures markup
// `createElement` would have left alone: `<p><div/></p>` becomes two siblings, a bare
// `<tr>` grows a `<tbody>`, non-table content is foster-parented out of a table.
// `codegen::static_tree::template_html` refuses those shapes — and this suite is what
// says that analysis is right in a real engine rather than on paper.
//
// For each fixture it compiles the *same* source twice — once normally, once with
// `OTFWC_NO_TEMPLATES=1` — loads both into headless Chromium, builds both, and
// requires the two DOM trees to be indistinguishable:
//
//   1. identical `outerHTML`;
//   2. identical structure node for node after `normalize()` — element names,
//      attribute sets, text data, child counts — so a difference that serializes the
//      same (a merged or dropped text node) still shows up;
//   3. at least one fixture actually took the template path, so a silently disabled
//      optimization cannot pass this suite by rendering "the same" as itself.
//
//   bun packages/web-cli/tests/e2e/template-parity.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides) and Chromium
// (CHROME_BIN overrides; skips cleanly if absent). Exits 0 if every assertion holds.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = HERE + "template-fixture";
// `packages/web/index.js` cannot be bundled by Bun: it re-exports `Link` from `.jsx`
// source that only *otfwc* knows how to compile. Every browser e2e here stands up its
// own entry from the plain-JS halves instead; the fixtures use no built-in components.
const WEB_SHIM = ["core/signals.js", "core/reactive.js", "core/errors.js", "runtime/index.js"]
  .map((f) => `export * from ${JSON.stringify(`${ROOT}packages/web/${f}`)};`)
  .join("\n");
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";
const PORT = 9357;

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.log(`• skipping template-parity e2e — no Chromium at ${CHROME} (set CHROME_BIN)`);
  process.exit(0);
}

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Compile one fixture to CSR JS. `templates: false` sets the OTFWC_NO_TEMPLATES escape hatch. */
function compile(file, templates, webShimPath) {
  const proc = Bun.spawnSync([OTFWC, "build", file], {
    env: { ...process.env, ...(templates ? {} : { OTFWC_NO_TEMPLATES: "1" }) },
  });
  if (proc.exitCode !== 0) throw new Error(`otfwc failed for ${file}:\n${proc.stderr}`);
  // The emitted module imports from the bare `@opentf/web` specifier; point it at the
  // shim so Bun can bundle it without a node_modules resolution.
  return proc.stdout.toString().replaceAll('"@opentf/web"', JSON.stringify(webShimPath));
}

/**
 * Bundle every fixture's two builds into one browser IIFE that exposes
 * `window.__CASES__ = [{ name, withTemplates, withoutTemplates }]` of factory pairs.
 */
async function bundle(cases, dir) {
  const imports = [];
  const entries = [];
  for (const [i, c] of cases.entries()) {
    const a = join(dir, `${c.name}.tmpl.js`);
    const b = join(dir, `${c.name}.plain.js`);
    writeFileSync(a, c.withTemplates);
    writeFileSync(b, c.withoutTemplates);
    imports.push(`import a${i} from ${JSON.stringify(a)};`);
    imports.push(`import b${i} from ${JSON.stringify(b)};`);
    entries.push(`{ name: ${JSON.stringify(c.name)}, withTemplates: a${i}, withoutTemplates: b${i} }`);
  }
  const entry = join(dir, "entry.js");
  writeFileSync(entry, `${imports.join("\n")}\nwindow.__CASES__ = [${entries.join(", ")}];\n`);
  let out;
  try {
    out = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife" });
  } catch (e) {
    for (const log of e?.errors ?? []) console.error(`  ${log}`);
    throw new Error(`Bun.build threw for the template-parity bundle: ${e?.message ?? e}`);
  }
  if (!out.success) {
    for (const log of out.logs) console.error(`  ${log}`);
    throw new Error("Bun.build failed for the template-parity bundle");
  }
  return await out.outputs[0].text();
}

async function fetchJSON(url) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out fetching ${url}`);
}

// Minimal CDP client (page-target WebSocket), mirroring the other e2e suites.
async function connectPage(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d?.exception?.description || d?.text || "exception");
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const m = ++id;
      pending.set(m, { res, rej });
      ws.send(JSON.stringify({ id: m, method, params }));
    });
  return { send, pageErrors, close: () => ws.close() };
}

async function evalJS(client, expression, awaitPromise = false) {
  const r = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) {
    throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  }
  return r.result.value;
}

// Runs in the page: build both variants of every case and compare the two trees.
const COMPARE = `(() => {
  // A structural fingerprint that survives serialization but not a real difference:
  // node kinds, tag names, sorted attribute pairs, text data, child counts.
  const shape = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return ["#text", node.data];
    if (node.nodeType === Node.COMMENT_NODE) return ["#comment", node.data];
    if (node.nodeType !== Node.ELEMENT_NODE) return ["#other", node.nodeType];
    const attrs = [...node.attributes]
      .map((a) => [a.name, a.value, a.namespaceURI])
      .sort((x, y) => (x[0] < y[0] ? -1 : 1));
    return [node.nodeName, node.namespaceURI, attrs, [...node.childNodes].map(shape)];
  };

  const build = (factory) => {
    const host = document.createElement("div");
    host.appendChild(factory({}));
    // Adjacent text nodes merge when markup is parsed but not when it is built one
    // \`createTextNode\` at a time. That difference is not observable — normalize both
    // sides so the structural compare stays about structure.
    host.normalize();
    return host;
  };

  return window.__CASES__.map((c) => {
    let a, b, error = null;
    try {
      a = build(c.withTemplates);
      b = build(c.withoutTemplates);
    } catch (e) {
      return { name: c.name, error: String(e && e.stack || e) };
    }
    return {
      name: c.name,
      error,
      htmlMatches: a.innerHTML === b.innerHTML,
      shapeMatches: JSON.stringify(shape(a)) === JSON.stringify(shape(b)),
      templated: a.innerHTML,
      plain: b.innerHTML,
    };
  });
})()`;

/** The first index at which two strings differ, with a little context either side. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `  at offset ${i}\n    templated: …${a.slice(from, i + 90)}\n    plain:     …${b.slice(from, i + 90)}`;
}

async function main() {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".jsx")).sort();
  if (!files.length) throw new Error(`no fixtures in ${FIXTURES}`);

  const dir = mkdtempSync(join(tmpdir(), "otfw-template-parity-"));
  const shim = join(dir, "web-shim.js");
  writeFileSync(shim, WEB_SHIM);

  const cases = files.map((f) => ({
    name: f.replace(/\.jsx$/, ""),
    withTemplates: compile(join(FIXTURES, f), true, shim),
    withoutTemplates: compile(join(FIXTURES, f), false, shim),
  }));

  // The escape hatch has to actually disable the optimization, or every comparison
  // below is a tree against itself.
  const stamped = cases.filter((c) => c.withTemplates.includes("= template("));
  assert(stamped.length > 0, `at least one fixture is compiled to templates (${stamped.length}/${cases.length})`);
  for (const c of cases) {
    assert(!c.withoutTemplates.includes("= template("), `OTFWC_NO_TEMPLATES disables stamping for ${c.name}`);
  }

  let code;
  try {
    code = await bundle(cases, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const chrome = Bun.spawn(
    [CHROME, "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  try {
    const client = await connectPage(PORT);
    await client.send("Runtime.enable");
    await evalJS(client, code);
    const results = await evalJS(client, COMPARE);

    for (const r of results) {
      if (r.error) throw new Error(`${r.name}: page threw while building\n${r.error}`);
      if (!r.htmlMatches) {
        throw new Error(`${r.name}: template clone renders different HTML\n${firstDifference(r.templated, r.plain)}`);
      }
      assert(r.htmlMatches, `${r.name}: identical outerHTML`);
      assert(r.shapeMatches, `${r.name}: identical node structure`);
    }
    if (client.pageErrors.length) {
      throw new Error(`page exceptions:\n    ${client.pageErrors.slice(0, 5).join("\n    ")}`);
    }
    client.close();
    console.log(`\n✅ template-parity — ${passed} assertions across ${results.length} fixtures\n`);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e?.message ?? e}\n`);
  process.exit(1);
});
