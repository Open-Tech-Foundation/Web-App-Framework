// The browser half of the e2e harness: a headless Chromium, a CDP client to drive it,
// and a bundler to get a fixture into the page.
//
// Four suites need a real engine — hydration adoption, lifecycle ordering, reparse
// behaviour and template-clone parity — and each had grown its own copy of this. It
// is one client now, the widest of the four: console errors and uncaught exceptions
// are always collected, because a silent hydration bug shows up as a logged
// `[otfw:hydrate] …` and a correct final DOM.

import { build } from "runtime:build";
import { env, exit } from "runtime:process";
import { Command } from "runtime:system";

import { exists, sleep } from "./lib.js";

export const CHROME = env.CHROME_BIN ?? "/usr/bin/chromium";

/**
 * The compiler is the build: without it the suite fails, because something is wrong
 * with the checkout. Chromium is the environment: without it the suite says so and
 * reports success, the way it would on a machine with no display stack at all.
 */
export async function requireCompiler(otfwc) {
  if (await exists(otfwc)) return;
  console.error(`✗ no otfwc at ${otfwc} (run \`cargo build\` for the compiler first)`);
  exit(1);
}

/**
 * Start headless Chromium with the DevTools protocol open on `port`, or skip the
 * suite if it will not start.
 *
 * Whether the browser is there is decided by trying to run it, not by looking for the
 * file: the sandbox is the project directory, so `/usr/bin/chromium` is not a path
 * this process can stat — and running a program is a separate capability from
 * reading one anyway.
 */
export async function startBrowser(port) {
  const skip = (why) => {
    console.log(`• skipping — ${why} (set CHROME_BIN)`);
    exit(0);
  };
  let chrome;
  try {
    chrome = await new Command(CHROME, {
      args: [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        "--no-sandbox",
        "--disable-gpu",
        "about:blank",
      ],
      stdout: "null",
      stderr: "null",
    }).spawn();
  } catch {
    return skip(`no Chromium at ${CHROME}`);
  }
  // A browser that is going to run stays running; one that cannot even start has
  // already exited by the time the protocol port would have opened.
  const exited = await Promise.race([chrome.status, sleep(300)]);
  if (exited) return skip(`Chromium at ${CHROME} exited immediately`);
  return chrome;
}

/** GET `url` as JSON, retrying while the server on the other end is still coming up. */
export async function fetchJSON(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* not listening yet */
    }
    await sleep(100);
  }
  throw new Error(`timed out fetching ${url}`);
}

/**
 * Attach to the browser's page target. Returns `send` for any CDP method, `once` to
 * await one event, and `pageErrors` — everything the page logged as an error or threw
 * uncaught, which several assertions are about.
 */
export async function connectPage(port) {
  const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));

  let id = 0;
  const pending = new Map();
  const waiters = [];
  const pageErrors = [];

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const text = msg.params.args.map((a) => a.value || a.description).join(" ");
        pageErrors.push(text);
        console.error("  [page error]", text);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        pageErrors.push(d?.exception?.description || d?.text || "exception");
      }
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) waiters.splice(i, 1)[0].res(msg.params);
      }
    }
  };

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const m = ++id;
      pending.set(m, { res, rej });
      ws.send(JSON.stringify({ id: m, method, params }));
    });

  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once, pageErrors, close: () => ws.close() };
}

/** Evaluate an expression in the page, surfacing a page-side throw as one here. */
export async function evalJS(client, expression, awaitPromise = false) {
  const r = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) {
    throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  }
  return r.result.value;
}

/**
 * Bundle `entry` into one script the page can run through `Runtime.evaluate` — an
 * IIFE, so it has no imports left and nothing to resolve in the browser.
 */
export async function bundleForBrowser(entry) {
  const bundle = await build({ input: entry, platform: "browser" });
  try {
    const { output } = await bundle.generate({ format: "iife" });
    return output.find((o) => o.type === "chunk").code;
  } finally {
    await bundle.close();
  }
}
