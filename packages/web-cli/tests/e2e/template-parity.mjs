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
//   esdev packages/web-cli/tests/e2e/template-parity.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build (OTFWC_BIN
// overrides) and Chromium (CHROME_BIN overrides; skips cleanly if absent). Exits 0 if
// every assertion holds.

import {
  assert,
  exec,
  HERE,
  OTFWC,
  passed,
  readNames,
  rmrf,
  ROOT,
  run,
  tempDir,
  writeFile,
} from "./lib.js";
import {
  bundleForBrowser,
  connectPage,
  evalJS,
  requireCompiler,
  startBrowser,
} from "./browser.js";

const FIXTURES = `${HERE}/template-fixture`;
// `packages/web/index.js` cannot go through the bundler as-is: it re-exports `Link`
// from `.jsx` source that only *otfwc* knows how to compile. Every browser e2e here
// stands up its own entry from the plain-JS halves instead; the fixtures use no
// built-in components.
const WEB_SHIM = ["core/signals.js", "core/reactive.js", "core/errors.js", "runtime/index.js"]
  .map((f) => `export * from ${JSON.stringify(`${ROOT}/packages/web/${f}`)};`)
  .join("\n");
const PORT = 9357;

await requireCompiler(OTFWC);

/** Compile one fixture to CSR JS. `templates: false` sets the OTFWC_NO_TEMPLATES escape hatch. */
async function compile(file, templates, webShimPath) {
  const { code, out, err } = await exec(OTFWC, ["build", file], {
    env: templates ? {} : { OTFWC_NO_TEMPLATES: "1" },
  });
  if (code !== 0) throw new Error(`otfwc failed for ${file}:\n${err}`);
  // The emitted module imports from the bare `@opentf/web` specifier; point it at the
  // shim so the bundle needs no node_modules resolution.
  return out.replaceAll('"@opentf/web"', JSON.stringify(webShimPath));
}

/**
 * Bundle every fixture's two builds into one browser IIFE that exposes
 * `window.__CASES__ = [{ name, withTemplates, withoutTemplates }]` of factory pairs.
 */
async function bundle(cases, dir) {
  const imports = [];
  const entries = [];
  for (const [i, c] of cases.entries()) {
    const a = `${dir}/${c.name}.tmpl.js`;
    const b = `${dir}/${c.name}.plain.js`;
    await writeFile(a, c.withTemplates);
    await writeFile(b, c.withoutTemplates);
    imports.push(`import a${i} from ${JSON.stringify(a)};`);
    imports.push(`import b${i} from ${JSON.stringify(b)};`);
    entries.push(`{ name: ${JSON.stringify(c.name)}, withTemplates: a${i}, withoutTemplates: b${i} }`);
  }
  const entry = `${dir}/entry.js`;
  await writeFile(entry, `${imports.join("\n")}\nwindow.__CASES__ = [${entries.join(", ")}];\n`);
  return bundleForBrowser(entry);
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
  const files = (await readNames(FIXTURES)).filter((f) => f.endsWith(".jsx")).sort();
  if (!files.length) throw new Error(`no fixtures in ${FIXTURES}`);

  const dir = await tempDir("otfw-template-parity");
  const shim = `${dir}/web-shim.js`;
  await writeFile(shim, WEB_SHIM);

  const cases = [];
  for (const f of files) {
    cases.push({
      name: f.replace(/\.jsx$/, ""),
      withTemplates: await compile(`${FIXTURES}/${f}`, true, shim),
      withoutTemplates: await compile(`${FIXTURES}/${f}`, false, shim),
    });
  }

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
    await rmrf(dir);
  }

  const chrome = await startBrowser(PORT);
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
    console.log(`  (${passed()} assertions across ${results.length} fixtures)`);
  } finally {
    chrome.kill();
  }
}

await run("template-parity e2e", main);
