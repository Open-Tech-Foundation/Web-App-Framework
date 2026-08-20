// End-to-end test for the `otfw dev` loop over a **docs** project (@opentf/web-docs).
//
//   esdev packages/web-cli/tests/e2e/dev-docs-hmr.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build (OTFWC_BIN) and
// `@opentf/web-docs` resolvable from the repo. Exits 0 if every assertion holds, 1
// otherwise.

import {
  assert,
  b64url,
  mkdirp,
  ROOT,
  rmrf,
  run,
  scratch,
  sleep,
  startDevServer,
  stop,
  symlink,
  writeTree,
  writeFile,
} from "./lib.js";

let APP; // the generated docs app, in the workspace scratch tree
const PORT_BASE = 43000;
const SETTLE = 2000;

const write = (rel, source) => writeFile(`${APP}/${rel}`, source);

async function scaffold() {
  APP = await scratch("dev-docs-app");
  await writeTree(APP, {
    "package.json": `${JSON.stringify({ name: "otfw-dev-docs-app", private: true, type: "module" })}\n`,
    "index.html": `<!doctype html><html><head><title>Docs</title></head><body><div id="app"></div></body></html>\n`,
    "otfw.config.js": `export default { docs: { title: "Fixture" } };\n`,
    // The sidebar tree, rendered as text — this is the chunk under test.
    "app/layout.jsx": `import nav from "@opentf/web-docs/nav";\nexport default function Layout({ children }) { return <main><pre>{JSON.stringify(nav)}</pre>{children}</main>; }\n`,
    "app/page.jsx": `export default function Home() { return <h1>Home</h1>; }\n`,
    "app/docs/_meta.js": `export default { alpha: "Alpha" };\n`,
    "app/docs/page.mdx": `---\ntitle: Docs\n---\n\nIndex.\n`,
    "app/docs/alpha/page.mdx": `---\ntitle: Alpha Page\n---\n\nAlpha body.\n`,
  });
}

// Point the fixture at the workspace packages, so the test exercises this checkout
// rather than whatever copy of @opentf/* the runtime's global cache happens to hold.
async function linkWorkspace() {
  const dir = `${APP}/node_modules/@opentf`;
  await mkdirp(dir);
  for (const name of ["web", "web-docs"]) {
    await rmrf(`${dir}/${name}`);
    await symlink(`${ROOT}/packages/${name}`, `${dir}/${name}`);
  }
}

const routeUrl = (file) => `/__route/${b64url(file)}.js`;

async function main() {
  await scaffold();
  await linkWorkspace();

  const { proc, port } = await startDevServer(APP, { portBase: PORT_BASE });

  const BASE = `http://localhost:${port}`;
  const text = async (path) => (await fetch(BASE + path)).text();
  const layout = `${APP}/app/layout.jsx`;
  const sidebar = () => text(routeUrl(layout));

  try {
    await text("/");
    await text("/bundle.js");
    assert((await sidebar()).includes("Alpha"), "the sidebar tree is generated into the layout chunk");

    // A page's frontmatter title is a sidebar label. The page is a real module, so
    // only *its* chunk would be invalidated by an import graph — the tree lives here.
    await write("app/docs/alpha/page.mdx", `---\ntitle: Alpha Page\nsidebar_label: Alpha Renamed\n---\n\nAlpha body.\n`);
    await sleep(SETTLE);
    const afterLabel = await sidebar();
    assert(
      afterLabel.includes("Alpha Renamed") || afterLabel.includes("Alpha"),
      "the sidebar chunk was rebuilt after a frontmatter edit",
    );
    // `_meta` wins over frontmatter, so assert the effective label after removing it below.

    // `_meta.js` — a JS module the plugin imports itself.
    await write("app/docs/_meta.js", `export default { alpha: "Alpha From Meta" };\n`);
    await sleep(SETTLE);
    assert((await sidebar()).includes("Alpha From Meta"), "a _meta.js label edit reaches the sidebar");

    await write("app/docs/_meta.js", `export default {};\n`);
    await sleep(SETTLE);
    const noMeta = await sidebar();
    assert(!noMeta.includes("Alpha From Meta"), "removing the _meta.js label reaches the sidebar");
    assert(noMeta.includes("Alpha Renamed"), "the page's own sidebar_label is used once _meta drops it");

    // A new page enters the tree.
    await write("app/docs/beta/page.mdx", `---\ntitle: Beta Page\n---\n\nBeta body.\n`);
    await sleep(SETTLE);
    assert((await sidebar()).includes("Beta Page"), "a new docs page enters the sidebar");

    // And leaves it again.
    await rmrf(`${APP}/app/docs/beta`);
    await sleep(SETTLE);
    assert(!(await sidebar()).includes("Beta Page"), "a deleted docs page leaves the sidebar");

    // A file the sidebar does *not* depend on must not invalidate it: the served
    // chunk should be byte-identical (it is served from cache).
    const before = await sidebar();
    await write("app/page.jsx", `export default function Home() { return <h1>Home 2</h1>; }\n`);
    await sleep(SETTLE);
    assert((await sidebar()) === before, "an unrelated page edit leaves the sidebar chunk cached");

  } finally {
    await stop(proc);
    await rmrf(APP);
  }
}

await run("dev-docs-hmr e2e", main);
