// SSG → parser → hydrate parity, in a real engine.
//
// The hydrate backend claims server nodes **positionally**, which assumes the bytes the
// SSG backend wrote re-parse into the tree they were generated from. The HTML parser does
// not always oblige: it drops a newline after `<pre>`, hands back the contents of a
// `<textarea>` as literal text (markers and all), wraps bare `<tr>`s in a `<tbody>`, and
// closes a `<p>` at the first block-level start tag. Every one of those shows up only in
// a browser — the `--dom` unit tests and the compiler's own tests both parse (or skip) their way past
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
//   esdev packages/web-cli/tests/e2e/reparse-browser.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build (OTFWC_BIN
// overrides) and Chromium (CHROME_BIN overrides; skips cleanly if absent). Exits 0 if
// every assertion holds.

import { assert, exec, HERE, OTFWC, readNames, rmrf, ROOT, run, tempDir, writeFile } from "./lib.js";
import {
  bundleForBrowser,
  connectPage,
  evalJS,
  requireCompiler,
  startBrowser,
} from "./browser.js";

const FIXTURES = `${HERE}/reparse-fixture`;
// `packages/web/index.js` re-exports `Link` from `.jsx` source only otfwc can compile,
// so the browser bundle stands its own runtime up from the plain-JS halves (as the
// other browser e2es do). The SSG half runs here and can use the real server entry.
const WEB_SHIM = ["core/signals.js", "core/reactive.js", "core/errors.js", "runtime/index.js"]
  .map((f) => `export * from ${JSON.stringify(`${ROOT}/packages/web/${f}`)};`)
  .join("\n");
const SERVER_ENTRY = `${ROOT}/packages/web/server/index.js`;
// The SSG module runs in this process, where the runtime half cannot even be imported
// (it defines Custom Elements at module scope), so its `@opentf/web` specifier
// resolves to the core signal helpers alone — which is all an SSG render reads.
const CORE_SHIM = ["core/signals.js", "core/reactive.js", "core/errors.js"]
  .map((f) => `export * from ${JSON.stringify(`${ROOT}/packages/web/${f}`)};`)
  .join("\n");
const PORT = 9358;

// Which fixtures the parser leaves alone (so they must adopt) and which it reshapes.
const ADOPTS = { rcdata: true, tables: true, inline: true, paragraph: false };

await requireCompiler(OTFWC);

/** Compile one fixture for `target` (csr | ssg | hydrate), pointing its imports at `shims`. */
async function compile(file, target, { web, server }) {
  const { code, out, err } = await exec(OTFWC, ["build", `--target=${target}`, file]);
  if (code !== 0) throw new Error(`otfwc ${target} failed for ${file}:\n${err}`);
  return out
    .replaceAll('"@opentf/web/server"', JSON.stringify(server))
    .replaceAll('"@opentf/web"', JSON.stringify(web));
}

/** Render a fixture's SSG module in this process — the HTML a visitor is served. */
async function renderSSG(code, dir, name) {
  const file = `${dir}/${name}.ssg.mjs`;
  await writeFile(file, code);
  const mod = await import(file);
  return mod.default({});
}

async function bundle(cases, dir) {
  const imports = [];
  const entries = [];
  for (const [i, c] of cases.entries()) {
    const csr = `${dir}/${c.name}.csr.js`;
    const hyd = `${dir}/${c.name}.hydrate.js`;
    await writeFile(csr, c.csr);
    await writeFile(hyd, c.hydrate);
    imports.push(`import build${i} from ${JSON.stringify(csr)};`);
    imports.push(`import * as hyd${i} from ${JSON.stringify(hyd)};`);
    entries.push(
      `{ name: ${JSON.stringify(c.name)}, serverHTML: ${JSON.stringify(c.serverHTML)},` +
        ` build: build${i}, hydrate: hyd${i}.hydrate }`,
    );
  }
  const entry = `${dir}/entry.js`;
  await writeFile(
    entry,
    `${imports.join("\n")}\n` +
      `import { beginHydration, endHydration } from ${JSON.stringify(`${dir}/web-shim.js`)};\n` +
      `window.__hydration = { beginHydration, endHydration };\n` +
      `window.__CASES__ = [${entries.join(", ")}];\n`,
  );
  return bundleForBrowser(entry);
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
  const files = (await readNames(FIXTURES)).filter((f) => f.endsWith(".jsx")).sort();
  if (!files.length) throw new Error(`no fixtures in ${FIXTURES}`);

  const dir = await tempDir("otfw-reparse");
  const web = `${dir}/web-shim.js`;
  await writeFile(web, WEB_SHIM);
  const core = `${dir}/web-core.js`;
  await writeFile(core, CORE_SHIM);
  const shims = { web, server: SERVER_ENTRY };
  const serverShims = { web: core, server: SERVER_ENTRY };

  let code;
  let cases;
  try {
    cases = [];
    for (const f of files) {
      const name = f.replace(/\.jsx$/, "");
      const path = `${FIXTURES}/${f}`;
      const serverHTML = await renderSSG(await compile(path, "ssg", serverShims), dir, name);
      cases.push({
        name,
        serverHTML,
        csr: await compile(path, "csr", shims),
        hydrate: await compile(path, "hydrate", shims),
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
    await rmrf(dir);
  }

  const chrome = await startBrowser(PORT);
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
    console.log(`  (across ${results.length} fixtures)`);
  } finally {
    chrome.kill();
  }
}

await run("reparse-browser e2e", main);
