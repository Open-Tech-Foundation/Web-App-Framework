// End-to-end test for the `otfw dev` edit → refresh loop. Spawns the *real* CLI
// against a generated app and edits files the way a developer does, asserting on
// both halves of the loop: the HMR frame the browser is sent, and what the server
// serves next. These are the cases that used to need a dev-server restart.
//
//   esdev packages/web-cli/tests/e2e/dev-hmr.mjs
//
// Run from the repository root. Needs the workspace otfwc debug build
// (target/debug/otfwc; override with OTFWC_BIN). Exits 0 if every assertion holds, 1
// otherwise. The generated app lives in a directory inside the repo (so `@opentf/web`
// resolves through the workspace) and is removed on the way out.

import {
  assert,
  b64url,
  cli,
  drain,
  mkdirp,
  ROOT,
  rmrf,
  run,
  scratch,
  sleep,
  stop,
  symlink,
  waitForOutput,
  writeTree,
  writeFile,
} from "./lib.js";

let APP; // the generated app, in the workspace scratch tree
const PORT_BASE = 41000;

// Long enough for a watcher event to be debounced, handled, and published.
const SETTLE = 1500;

const write = async (rel, source) => {
  const file = `${APP}/${rel}`;
  await writeFile(file, source);
  return file;
};

async function scaffold() {
  APP = await scratch("dev-hmr-app");
  await writeTree(APP, {
    "package.json": `${JSON.stringify({ name: "otfw-dev-hmr-app", private: true, type: "module" })}\n`,
    "index.html": `<!doctype html><html><head><title>HMR</title></head><body><div id="app"></div></body></html>\n`,
    "app/layout.jsx": `export default function Layout({ children }) { return <main>{children}</main>; }\n`,
    "lib/label.js": `export const label = "LIB-1";\n`,
    "app/page.jsx": `import { label } from "../lib/label.js";\nexport default function Home() { return <h1>HOME-1 {label}</h1>; }\n`,
    "public/asset.txt": "ASSET-1",
  });
}

// Point the fixture at the workspace packages, so the test exercises this checkout
// rather than whatever copy of @opentf/* the runtime's global cache happens to hold.
async function linkWorkspace() {
  const dir = `${APP}/node_modules/@opentf`;
  await mkdirp(dir);
  for (const name of ["web"]) {
    await rmrf(`${dir}/${name}`);
    await symlink(`${ROOT}/packages/${name}`, `${dir}/${name}`);
  }
}

// Start the dev server on a free high port. Not the default 3000: a developer's own
// server (and the browser tab pointed at it) commonly owns that one, and it would
// answer these requests — or take the reloads meant for this test. A port we pick can
// still be taken, so a busy one is retried rather than failing the run.
async function startDevServer(attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const port = PORT_BASE + Math.floor(Math.random() * 2000);
    const proc = await cli(["dev", `--port=${port}`], { root: APP });
    try {
      await waitForOutput(
        proc.stdout,
        (buf) => buf.includes(`localhost:${port}`) && /ready in/.test(buf),
        { what: `the dev server on port ${port}` },
      );
    } catch (e) {
      await stop(proc);
      if (i === attempts - 1) throw e;
      continue;
    }
    // Keep draining so the child never blocks on a full stdout pipe.
    void drain(proc.stdout);
    return { proc, port };
  }
}

const routeUrl = (file) => `/__route/${b64url(file)}.js`;

async function main() {
  await scaffold();
  await linkWorkspace();

  const { proc, port } = await startDevServer();

  const BASE = `http://localhost:${port}`;
  const text = async (path) => (await fetch(BASE + path)).text();

  // The HMR socket, standing in for the browser's dev client.
  let frames = [];
  const connect = async () => {
    const ws = new WebSocket(`ws://localhost:${port}/__hmr`);
    ws.addEventListener("message", (e) => frames.push(JSON.parse(e.data)));
    await new Promise((r) => ws.addEventListener("open", r));
    return ws;
  };
  const ws = await connect();
  // Every caller clears `frames` before the edit it is about to make, and awaiting a
  // write yields — long enough for a fast reload to arrive and be thrown away if this
  // cleared them again.
  const settle = async (ms = SETTLE) => {
    await sleep(ms);
    return frames;
  };
  const reloaded = (f) => f.some((m) => m.type === "reload");
  const errored = (f) => f.some((m) => m.type === "error");

  const page = `${APP}/app/page.jsx`;
  const lib = `${APP}/lib/label.js`;

  try {
    // Prime the caches the way a first page load does.
    await text("/");
    await text("/bundle.js");
    await text(routeUrl(page));

    // ---- a page edit refreshes the page ------------------------------------
    frames = [];
    await write("app/page.jsx", `import { label } from "../lib/label.js";\nexport default function Home() { return <h1>HOME-2 {label}</h1>; }\n`);
    assert(reloaded(await settle()), "page edit publishes a reload");
    assert((await text(routeUrl(page))).includes("HOME-2"), "page edit rebuilds the route chunk");

    // ---- a module outside app/ is watched too -------------------------------
    frames = [];
    await write("lib/label.js", `export const label = "LIB-2";\n`);
    assert(reloaded(await settle()), "a module outside app/ publishes a reload");
    assert((await text(routeUrl(page))).includes("LIB-2"), "a module outside app/ rebuilds its importers");

    // ---- a page added while the server runs ---------------------------------
    frames = [];
    const added = await write("app/added/page.jsx", `export default function Added() { return <p>ADDED-1</p>; }\n`);
    assert(reloaded(await settle()), "a new page publishes a reload");
    assert((await text("/bundle.js")).includes("/app/added/page.jsx"), "a new page enters the route table without a restart");
    assert((await text(routeUrl(added))).includes("ADDED-1"), "a new page compiles on request");

    // ---- and removed again --------------------------------------------------
    frames = [];
    await rmrf(`${APP}/app/added`);
    assert(reloaded(await settle()), "a deleted page publishes a reload");
    assert(!(await text("/bundle.js")).includes("/app/added/page.jsx"), "a deleted page leaves the route table");

    // ---- index.html and public/ --------------------------------------------
    frames = [];
    await write("index.html", `<!doctype html><html><head><title>HMR-2</title></head><body><div id="app"></div></body></html>\n`);
    assert(reloaded(await settle()), "an index.html edit publishes a reload");
    assert((await text("/")).includes("HMR-2"), "the new shell is served");

    frames = [];
    await write("public/asset.txt", "ASSET-2");
    assert(reloaded(await settle()), "a public/ asset edit publishes a reload");
    assert((await text("/asset.txt")).includes("ASSET-2"), "the new asset is served");

    // ---- otfw.config.js -----------------------------------------------------
    // A JS config is re-imported through a versioned bundle; without that the
    // runtime's ESM cache would keep serving the config as it was at startup.
    frames = [];
    await write("otfw.config.js", `export default { i18n: { locales: ["en", "fr"], defaultLocale: "en" } };\n`);
    assert(reloaded(await settle()), "creating otfw.config.js publishes a reload");
    assert((await text("/bundle.js")).includes(`"fr"`), "the entry picks up the new config");

    frames = [];
    await write("otfw.config.js", `export default { i18n: { locales: ["en", "de"], defaultLocale: "en" } };\n`);
    assert(reloaded(await settle()), "editing otfw.config.js publishes a reload");
    const reconfigured = await text("/bundle.js");
    assert(reconfigured.includes(`"de"`) && !reconfigured.includes(`"fr"`), "the entry picks up the edited config");
    await rmrf(`${APP}/otfw.config.js`);
    await sleep(SETTLE);

    // ---- a compile error, and recovering from it ----------------------------
    await write("app/page.jsx", `export default function Home() { const = ; }\n`);
    await sleep(SETTLE);
    frames = [];
    await text(routeUrl(page)); // the browser asks for the broken chunk
    await sleep(400);
    assert(errored(frames), "a compile error is pushed to the overlay");

    // The overlay needs to say *where*, not just *what*: a project-relative file, a
    // 1-based line and column, and the code frame the compiler rendered — with no
    // terminal color escapes, which the overlay would print literally.
    {
      const err = frames.find((m) => m.type === "error");
      assert(err.file === "app/page.jsx", `the diagnostic names the file (${err.file})`);
      assert(err.line === 1, `the diagnostic carries the line (${err.line})`);
      assert(typeof err.column === "number" && err.column > 0, `the diagnostic carries the column (${err.column})`);
      assert(/^\s*1 \| export default/m.test(err.frame ?? ""), "the diagnostic carries a code frame");
      assert(err.frame.includes("^"), "the code frame underlines the offending span");
      assert(!/\u001b\[/.test(err.message + err.frame), "no terminal escapes reach the overlay");
    }

    frames = [];
    await write("app/page.jsx", `import { label } from "../lib/label.js";\nexport default function Home() { return <h1>HOME-3 {label}</h1>; }\n`);
    const afterFix = await settle(2000);
    assert(reloaded(afterFix) && !errored(afterFix), "fixing it publishes a reload, not the stale error");
    assert((await text(routeUrl(page))).includes("HOME-3"), "the fixed module is rebuilt");

    frames = [];
    const ws2 = await connect(); // a reconnecting page must not be shown the old error
    await sleep(500);
    assert(!errored(frames), "a fresh connection is not replayed a fixed error");
    ws2.close();

    // ---- a bundler-level failure is located too -----------------------------
    // Rolldown reports its own errors in its own format; the position it prints is
    // lifted into the same fields, so the overlay header reads the same either way.
    await write("app/page.jsx", `import missing from "./nope.js";\nexport default function Home() { return <h1>{missing}</h1>; }\n`);
    await sleep(SETTLE);
    frames = [];
    await text(routeUrl(page));
    await sleep(400);
    {
      const err = frames.find((m) => m.type === "error");
      assert(err && err.line === 1, "a bundler error carries a line");
      assert(err.file === "app/page.jsx", `a bundler error names the file (${err.file})`);
      assert(!/\u001b\[/.test(err.message), "a bundler error reaches the overlay without color codes");
    }
    await write("app/page.jsx", `import { label } from "../lib/label.js";\nexport default function Home() { return <h1>HOME-3 {label}</h1>; }\n`);
    await sleep(SETTLE);

    // ---- the dev entry heals itself ----------------------------------------
    // `.dev/` is a generated directory: a `git clean`, a temp sweeper or a stray
    // `rm -rf` can take it away mid-session. That used to wedge the server in a
    // permanent "Cannot resolve entry module .dev/entry.js".
    await rmrf(`${APP}/.dev`);
    frames = [];
    await write("app/page.jsx", `import { label } from "../lib/label.js";\nexport default function Home() { return <h1>HOME-4 {label}</h1>; }\n`);
    await settle();
    const entry = await text("/bundle.js");
    assert(!/Cannot resolve entry|Compile error/i.test(entry), "the entry is regenerated after .dev/ is removed");
    assert(entry.includes("mountApp"), "the regenerated entry is a real bundle");

    // ---- a burst of writes is one reload, not one per event -----------------
    frames = [];
    for (let i = 0; i < 5; i++) {
      await write("app/page.jsx", `import { label } from "../lib/label.js";\nexport default function Home() { return <h1>BURST-${i} {label}</h1>; }\n`);
      await sleep(15);
    }
    await sleep(2000);
    assert(frames.filter((m) => m.type === "reload").length <= 2, "a burst of saves collapses into a single reload");

  } finally {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    await stop(proc);
    await rmrf(APP);
  }
}

await run("dev-hmr e2e", main);
