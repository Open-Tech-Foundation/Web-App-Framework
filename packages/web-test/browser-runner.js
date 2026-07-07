// In-page test runner — a tiny bun:test-compatible surface (describe/test/expect) that lets
// the hi-fi runtime tests run inside a REAL headless browser instead of happy-dom. The
// Bun-side orchestrator (packages/web-cli/tests/e2e/runtime-browser.mjs) bundles this plus the
// `*.browser.js` test files for the browser, loads them in Chromium, and calls `window.__run()`.
//
// Why a browser: these files probe the paths where happy-dom's fidelity diverges from a real
// engine — custom-element upgrade timing, the real microtask/event loop, portal relocation,
// event delegation. Everything else stays fast under `bun test` + happy-dom.

const TESTS = [];
let suite = "";

export function describe(name, fn) {
  const prev = suite;
  suite = prev ? `${prev} > ${name}` : name;
  fn();
  suite = prev;
}

export function test(name, fn) {
  TESTS.push({ name: suite ? `${suite} > ${name}` : name, fn });
}
export const it = test;

// Optional lifecycle hooks (none of the current files use them, but support them so a
// migrated file that grows one keeps working).
const beforeHooks = [];
const afterHooks = [];
export function beforeEach(fn) {
  beforeHooks.push(fn);
}
export function afterEach(fn) {
  afterHooks.push(fn);
}

function fmt(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function fail(msg) {
  throw new Error(msg);
}

// A matcher set; `neg` inverts it (drives `.not`).
function matchers(recv, neg) {
  const check = (pass, desc) => {
    if (pass === neg) fail(`expected ${fmt(recv)} ${neg ? "not " : ""}${desc}`);
  };
  return {
    toBe: (exp) => check(Object.is(recv, exp), `to be ${fmt(exp)}`),
    toEqual: (exp) => check(deepEqual(recv, exp), `to equal ${fmt(exp)}`),
    toContain: (exp) => check(typeof recv?.includes === "function" && recv.includes(exp), `to contain ${fmt(exp)}`),
    toBeNull: () => check(recv === null, "to be null"),
    toBeUndefined: () => check(recv === undefined, "to be undefined"),
    toBeDefined: () => check(recv !== undefined, "to be defined"),
    toBeTruthy: () => check(!!recv, "to be truthy"),
    toBeFalsy: () => check(!recv, "to be falsy"),
    toThrow: (expected) => {
      let threw = false;
      let err;
      try {
        recv();
      } catch (e) {
        threw = true;
        err = e;
      }
      if (neg) {
        if (threw) fail(`expected function not to throw, but it threw ${fmt(err?.message ?? err)}`);
        return;
      }
      if (!threw) fail("expected function to throw, but it did not");
      if (expected == null) return;
      if (typeof expected === "function") {
        if (!(err instanceof expected)) {
          fail(`expected error to be instanceof ${expected.name}, got ${err?.constructor?.name ?? fmt(err)}`);
        }
      } else if (expected instanceof RegExp) {
        if (!expected.test(String(err?.message))) fail(`expected error message to match ${expected}`);
      } else if (typeof expected === "string") {
        if (!String(err?.message).includes(expected)) fail(`expected error message to contain ${fmt(expected)}`);
      }
    },
  };
}

export function expect(recv) {
  const m = matchers(recv, false);
  m.not = matchers(recv, true);
  return m;
}

// Reset the shared document between tests — the browser equivalent of the happy-dom suite's
// afterEach cleanup. Clears the body and any styles/head nodes the runtime injected.
function resetDom() {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-otfw-style], [data-otfw]").forEach((n) => n.remove());
}

// Run every collected test sequentially and return a plain results array the orchestrator
// marshals back over CDP. Never throws — a thrown assertion becomes a failing result.
export async function __run() {
  const results = [];
  for (const t of TESTS) {
    resetDom();
    try {
      for (const h of beforeHooks) await h();
      await t.fn();
      for (const h of afterHooks) await h();
      results.push({ name: t.name, pass: true });
    } catch (e) {
      results.push({ name: t.name, pass: false, error: e?.message ?? String(e), stack: e?.stack });
    }
  }
  return results;
}

if (typeof window !== "undefined") window.__run = __run;
