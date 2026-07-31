// SSG → parser → hydrate parity, in a real engine.
//
// The hydrate backend claims server nodes **positionally**, which assumes the bytes the
// SSG backend wrote re-parse into the tree they were generated from. The HTML parser does
// not always oblige: it drops a newline after `<pre>`, hands back the contents of a
// `<textarea>` as literal text (markers and all), wraps bare `<tr>`s in a `<tbody>`, and
// closes a `<p>` at the first block-level start tag. Every one of those shows up only in
// a browser — happy-dom and the compiler's own tests both parse (or skip) their way past
// it — which is why this suite exists.
//
// For each fixture it renders the SSG HTML in Bun, then in headless Chromium:
//
//   1. **Served bytes are honest** — no hydration marker ever lands inside raw text, and
//      the value a no-JS visitor sees (`textarea.value`, the stylesheet text) is the
//      value the component rendered.
//   2. **Server and client trees agree** — the parsed server HTML has the same shape as
//      the DOM the CSR backend builds from the same source, ignoring marker comments.
//   3. **Adoption is all-or-nothing, and decided at compile time** — a fixture the parser
//      leaves alone exposes a `hydrate` factory that adopts every server node (zero
//      removals); one it reshapes exposes none at all, so the router builds cleanly on
//      the client instead of throwing a `HydrationMismatch` partway through a walk.
//
//   bun packages/web-cli/tests/e2e/reparse-browser.mjs
//
// Needs the workspace otfwc debug build (OTFWC_BIN overrides) and Chromium
// (CHROME_BIN overrides; skips cleanly if absent). Exits 0 if every assertion holds.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = HERE + "reparse-fixture";
// `packages/web/index.js` re-exports `Link` from `.jsx` source only otfwc can compile, so
// the browser bundle stands its own runtime up from the plain-JS halves (as the other
// browser e2es do). The SSG half runs in Bun and can use the real server entry.
const WEB_SHIM = ["core/signals.js", "core/reactive.js", "core/errors.js", "runtime/index.js"]
  .map((f) => `export * from ${JSON.stringify(`${ROOT}packages/web/${f}`)};`)
  .join("\n");
const SERVER_ENTRY = `${ROOT}packages/web/server/index.js`;
// The SSG module runs in Bun, where the runtime half can't even be imported (it defines
// Custom Elements at module scope), so its `@opentf/web` specifier resolves to the core
// signal helpers alone — which is all an SSG render reads.
const CORE_SHIM = ["core/signals.js", "core/reactive.js", "core/errors.js"]
  .map((f) => `export * from ${JSON.stringify(`${ROOT}packages/web/${f}`)};`)
  .join("\n");
const OTFWC = process.env.OTFWC_BIN || ROOT + "target/debug/otfwc";
const CHROME = process.env.CHROME_BIN || "/usr/bin/chromium";
const PORT = 9358;

// Which fixtures the parser leaves alone (so they must adopt) and which it reshapes.
const ADOPTS = { rcdata: true, tables: true, inline: true, paragraph: false };

if (!existsSync(OTFWC)) {
  console.error(`✗ no otfwc at ${OTFWC} (run \`cargo build\` for the compiler first)`);
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.log(`• skipping reparse-browser e2e — no Chromium at ${CHROME} (set CHROME_BIN)`);
  process.exit(0);
}

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Compile one fixture for `target` (csr | ssg | hydrate), pointing its imports at `shims`. */
function compile(file, target, { web, server }) {
  const proc = Bun.spawnSync([OTFWC, "build", `--target=${target}`, file]);
  if (proc.exitCode !== 0) throw new Error(`otfwc ${target} failed for ${file}:\n${proc.stderr}`);
  return proc.stdout
    .toString()
    .replaceAll('"@opentf/web/server"', JSON.stringify(server))
    .replaceAll('"@opentf/web"', JSON.stringify(web));
}

/** Render a fixture's SSG module here in Bun — the HTML a visitor is served. */
async function renderSSG(code, dir, name) {
  const file = join(dir, `${name}.ssg.mjs`);
  writeFileSync(file, code);
  const mod = await import(file);
  return mod.default({});
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

async function evalJS(client, expression) {
  const r = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  }
  return r.result.value;
}

/**
 * Bundle every fixture's CSR + hydrate modules into one browser IIFE exposing
 * `window.__CASES__ = [{ name, serverHTML, build, hydrate }]`.
 */
async function bundle(cases, dir) {
  const imports = [];
  const entries = [];
  for (const [i, c] of cases.entries()) {
    const csr = join(dir, `${c.name}.csr.js`);
    const hyd = join(dir, `${c.name}.hydrate.js`);
    writeFileSync(csr, c.csr);
    writeFileSync(hyd, c.hydrate);
    imports.push(`import build${i} from ${JSON.stringify(csr)};`);
    imports.push(`import * as hyd${i} from ${JSON.stringify(hyd)};`);
    entries.push(
      `{ name: ${JSON.stringify(c.name)}, serverHTML: ${JSON.stringify(c.serverHTML)},` +
        ` build: build${i}, hydrate: hyd${i}.hydrate }`,
    );
  }
  const entry = join(dir, "entry.js");
  writeFileSync(
    entry,
    `${imports.join("\n")}\n` +
      `import { beginHydration, endHydration } from ${JSON.stringify(join(dir, "web-shim.js"))};\n` +
      `window.__hydration = { beginHydration, endHydration };\n` +
      `window.__CASES__ = [${entries.join(", ")}];\n`,
  );
  const out = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife" });
  if (!out.success) {
    for (const log of out.logs) console.error(`  ${log}`);
    throw new Error("Bun.build failed for the reparse bundle");
  }
  return await out.outputs[0].text();
}

// Runs in the page. For each case: parse the server HTML, build the CSR tree from the
// same source, compare their shapes, then hydrate the parsed server DOM and report what
// the hydration pass tore out.
const RUN = `(() => {
  // Structure only: tags, sorted attributes, text, children. Two things are normalized
  // away because they are how the two backends differ *by design*, not in tree shape:
  // the hydration marker comments (they exist to find nodes; the CSR build has no
  // equivalent) and the text-node boundaries those markers create — the parser keeps
  // "label " and "0" apart around a comment, while a built tree normalize()s them into
  // one. Everything else — an element the parser moved, wrapped or dropped — survives.
  const IGNORED_ATTRS = new Set(["data-h", "data-hp"]);
  const children = (node) => {
    const out = [];
    let text = "";
    const flush = () => { if (text.trim() !== "") out.push(["#text", text]); text = ""; };
    for (const child of node.childNodes) {
      if (child.nodeType === Node.COMMENT_NODE) continue;
      if (child.nodeType === Node.TEXT_NODE) { text += child.data; continue; }
      flush();
      out.push(shape(child));
    }
    flush();
    return out;
  };
  const shape = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return ["#other", node.nodeType];
    const attrs = [...node.attributes]
      .filter((a) => !IGNORED_ATTRS.has(a.name))
      .map((a) => [a.name, a.value])
      .sort((x, y) => (x[0] < y[0] ? -1 : 1));
    return [node.nodeName, attrs, children(node)];
  };

  return window.__CASES__.map((c) => {
    const server = document.createElement("div");
    server.innerHTML = c.serverHTML;

    const client = document.createElement("div");
    client.appendChild(c.build({}));
    client.normalize();

    // Tag every parsed server node, then hydrate and see which tags went missing —
    // the same "was it adopted or rebuilt?" test the hydration e2e uses.
    const tagged = [...server.querySelectorAll("*")];
    let hydrateError = null;
    if (c.hydrate) {
      try {
        window.__hydration.beginHydration();
        c.hydrate(server, {});
      } catch (e) {
        hydrateError = String((e && e.stack) || e);
      } finally {
        window.__hydration.endHydration();
      }
    }
    const discarded = tagged.filter((n) => !server.contains(n)).length;

    const ta = server.querySelector("textarea");
    const style = server.querySelector("style");
    return {
      name: c.name,
      hasHydrate: !!c.hydrate,
      hydrateError,
      discarded,
      serverShape: JSON.stringify(shape(server)),
      clientShape: JSON.stringify(shape(client)),
      serverHTML: server.innerHTML,
      clientHTML: client.innerHTML,
      textareaValue: ta ? ta.value : null,
      styleText: style ? style.textContent : null,
      firstTableChild: server.querySelector("table.bare")?.firstElementChild?.tagName ?? null,
    };
  });
})()`;

async function main() {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".jsx")).sort();
  if (!files.length) throw new Error(`no fixtures in ${FIXTURES}`);

  const dir = mkdtempSync(join(tmpdir(), "otfw-reparse-"));
  const web = join(dir, "web-shim.js");
  writeFileSync(web, WEB_SHIM);
  const core = join(dir, "web-core.js");
  writeFileSync(core, CORE_SHIM);
  const shims = { web, server: SERVER_ENTRY };
  const serverShims = { web: core, server: SERVER_ENTRY };

  let code;
  let cases;
  try {
    cases = [];
    for (const f of files) {
      const name = f.replace(/\.jsx$/, "");
      const path = join(FIXTURES, f);
      const serverHTML = await renderSSG(compile(path, "ssg", serverShims), dir, name);
      cases.push({
        name,
        serverHTML,
        csr: compile(path, "csr", shims),
        hydrate: compile(path, "hydrate", shims),
      });
    }

    // The served bytes, before any browser is involved.
    for (const c of cases) {
      const raw = c.serverHTML.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>|<style>([\s\S]*?)<\/style>/g) ?? [];
      for (const chunk of raw) {
        assert(!chunk.includes("<!--"), `${c.name}: no hydration markers inside raw text`);
      }
      if (c.name === "tables") {
        assert(/<table class="bare"><tbody>/.test(c.serverHTML), "tables: bare rows are served inside a <tbody>");
      }
      // Adoptability is a compile-time decision: the `hydrate` factory exists only for
      // views whose bytes come back unchanged.
      const has = /export function hydrate\b/.test(c.hydrate);
      assert(has === ADOPTS[c.name], `${c.name}: ${ADOPTS[c.name] ? "emits" : "refuses"} a hydrate factory`);
    }

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
    const results = await evalJS(client, RUN);

    for (const r of results) {
      if (r.hydrateError) throw new Error(`${r.name}: hydrate threw\n${r.hydrateError}`);
      if (ADOPTS[r.name]) {
        if (r.serverShape !== r.clientShape) {
          throw new Error(
            `${r.name}: the parsed server tree differs from the CSR build\n` +
              `    server: ${r.serverHTML}\n    client: ${r.clientHTML}`,
          );
        }
        assert(true, `${r.name}: server HTML parses to the tree CSR builds`);
        assert(r.discarded === 0, `${r.name}: hydration adopted every server node (0 discarded)`);
      } else {
        // The refusal has to be *earned*: this fixture is here because the parser really
        // does hand back a different tree, which is why no adopt factory was emitted.
        assert(
          r.serverShape !== r.clientShape,
          `${r.name}: the parser reshapes it, so refusing to adopt is right`,
        );
      }
      if (r.name === "rcdata") {
        assert(r.textareaValue === "first line\nsecond line", "rcdata: the textarea shows its value, not markers");
        assert(r.styleText === ".swatch > b { color: red }", "rcdata: the stylesheet is served unescaped");
      }
      if (r.name === "tables") {
        assert(r.firstTableChild === "TBODY", "tables: the parser found the <tbody> already there");
      }
    }
    if (client.pageErrors.length) {
      throw new Error(`page exceptions:\n    ${client.pageErrors.slice(0, 5).join("\n    ")}`);
    }
    client.close();
    console.log(`\n✅ reparse-browser — ${passed} assertions across ${results.length} fixtures\n`);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e?.message ?? e}\n`);
  process.exit(1);
});
