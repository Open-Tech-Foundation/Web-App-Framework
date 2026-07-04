// End-to-end test for `otfw serve` (SSR Phase 1). Spawns the *real* CLI against a
// minimal fixture app (tests/e2e/fixture) and drives it over HTTP — the half the
// unit tests can't cover: the full build → server-bundle → per-request render path,
// the static-asset serving, the HTTP status codes, and the client-bundle injection.
//
//   bun packages/web-cli/tests/e2e/serve.mjs
//
// Needs the workspace otfwc debug build (../../../../target/debug/otfwc; override
// with OTFWC_BIN) so the fixture's JSX compiles. Exits 0 if every assertion holds,
// 1 otherwise. The fixture's build artifacts (dist/, temp dirs) are cleaned up.

import { rmSync } from "node:fs";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Remove the fixture's generated build output between/after runs.
function cleanFixture() {
  for (const d of ["dist", ".otfw", ".otfw-ssg", ".otfw-api", ".dev"]) {
    rmSync(`${FIXTURE}/${d}`, { recursive: true, force: true });
  }
}

// Read the child's stdout until the "ready" line appears, returning the bound port.
async function waitForReady(proc, timeoutMs = 60000) {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk);
    const m = buf.match(/http:\/\/localhost:(\d+)/);
    if (m && /ready in/.test(buf)) return Number(m[1]);
    if (Date.now() > deadline) break;
  }
  throw new Error(`server did not become ready in ${timeoutMs}ms:\n${buf}`);
}

async function main() {
  cleanFixture();

  const proc = Bun.spawn(["bun", CLI, "serve"], {
    cwd: FIXTURE,
    env: { ...process.env, OTFWC_BIN: OTFWC },
    stdout: "pipe",
    stderr: "inherit",
  });

  let port;
  try {
    port = await waitForReady(proc);
    // 127.0.0.1, not `localhost` — the latter can resolve to IPv6 (::1) and hit an
    // unrelated dev server on the same port on the other stack (`otfw serve` binds IPv4).
    const base = `http://127.0.0.1:${port}`;

    // ── 1. A matched route is server-rendered into #app (status 200) ───────────
    const home = await fetch(`${base}/`);
    const homeHtml = await home.text();
    assert(home.status === 200, "GET / → 200");
    assert(
      /<div id="app"[^>]*>[\s\S]*E2E_HOME[\s\S]*<\/div>/.test(homeHtml),
      "/ markup is server-rendered inside #app (no client round-trip)",
    );

    // ── 2. The client bundle is injected, so the page becomes interactive ──────
    const scriptMatch = homeHtml.match(/<script type="module" src="(\/assets\/[^"]+\.js)">/);
    assert(!!scriptMatch, "/ injects the client bundle <script>");

    // ── 2b. The shell stamps the hydration sentinel on #app (the client adopts the
    //        server markup on first paint instead of rebuilding it) ──────────────
    assert(
      /<div id="app"[^>]*\bdata-otfw-hydrate\b[^>]*>/.test(homeHtml),
      "/ stamps data-otfw-hydrate on #app (hydration boot)",
    );

    // ── 3. That bundle is actually served as JS from dist/ ─────────────────────
    const asset = await fetch(`${base}${scriptMatch[1]}`);
    assert(asset.status === 200, `GET ${scriptMatch[1]} → 200`);
    assert(
      (asset.headers.get("content-type") || "").includes("javascript"),
      "client bundle is served with a javascript content-type",
    );

    // ── 4. A second route renders its own markup + <head> per request ──────────
    const about = await fetch(`${base}/about`);
    const aboutHtml = await about.text();
    assert(about.status === 200, "GET /about → 200");
    assert(aboutHtml.includes("E2E_ABOUT"), "/about renders its own page markup");
    assert(aboutHtml.includes("<title>About — E2E</title>"), "/about injects its generateMetadata title");

    // ── 5. An unmatched path renders the 404 page with HTTP 404 ────────────────
    const missing = await fetch(`${base}/no-such-route`);
    const missingHtml = await missing.text();
    assert(missing.status === 404, "GET /no-such-route → 404 status");
    assert(missingHtml.includes("E2E_404"), "the registered 404 page is rendered on a miss");

    // ── 6. API routes (SPEC §11): file-based Request→Response handlers ─────────
    const status = await fetch(`${base}/api/status`);
    assert(status.status === 200, "GET /api/status → 200");
    assert((await status.json()).ok === true, "/api/status returns its JSON body");

    const created = await fetch(`${base}/api/status`, {
      method: "POST",
      body: JSON.stringify({ n: 1 }),
    });
    assert(created.status === 201, "POST /api/status → 201 (method-based handler)");
    assert((await created.json()).received.n === 1, "POST body is read from the standard Request");

    const appt = await fetch(`${base}/api/appointments`);
    assert(appt.status === 200, "GET /api/appointments → 200 (app-prefixed folder not clipped)");
    assert((await appt.json()).booked === true, "/api/appointments returns its JSON body");

    const user = await fetch(`${base}/api/users/42`);
    const userJson = await user.json();
    assert(user.status === 200, "GET /api/users/42 → 200");
    assert(userJson.id === "42", "dynamic [id] param resolves");
    assert(userJson.viaMiddleware === "mw", "_middleware ran and passed data via locals");

    const notAMethod = await fetch(`${base}/api/status`, { method: "DELETE" });
    assert(notAMethod.status === 405, "unhandled method → 405");
    assert((notAMethod.headers.get("allow") || "").includes("GET"), "405 carries an Allow header");

    const blocked = await fetch(`${base}/api/secret`);
    assert(blocked.status === 401, "middleware short-circuits /api/secret → 401");
    const allowed = await fetch(`${base}/api/secret`, { headers: { authorization: "t" } });
    assert(allowed.status === 200, "authorized /api/secret → 200 (middleware calls next)");

    const apiMiss = await fetch(`${base}/api/nope`);
    assert(apiMiss.status === 404, "unmatched /api/* with no page → 404");

    // A page can live under /api alongside handlers: a handler miss falls through to SSR.
    const apiPage = await fetch(`${base}/api/docs`);
    const apiPageHtml = await apiPage.text();
    assert(apiPage.status === 200, "GET /api/docs → 200 (page under /api renders)");
    assert(apiPageHtml.includes("E2E_API_DOCS_PAGE"), "/api/docs page falls through to SSR");

    console.log(`\n✓ otfw serve e2e — ${passed} assertions passed\n`);
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
    cleanFixture();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e?.message ?? e}\n`);
  process.exit(1);
});
