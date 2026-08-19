// A `describe`/`test`/`expect` surface over `runtime:test`.
//
// The runtime's test module is deliberately five functions wide — `test`, `assert`,
// `assertEquals`, `assertThrows`, `assertRejects` — with no suites, no lifecycle
// hooks and no matchers. The suites here predate that and read better with them, so
// this shim supplies the missing layer rather than flattening every file.
//
// Two behaviours are worth knowing:
//
//   * `runtime:test` starts a test the moment it is registered, so an async test runs
//     concurrently with the ones after it. Lifecycle hooks are meaningless under that,
//     so registration is deferred to a microtask and every test is chained behind its
//     predecessor — the file runs top to bottom, one test at a time.
//   * A failure is an exception. Every matcher throws, so the runtime reports the
//     message and the frame inside the test file that produced it.

import { test as rtTest } from "runtime:test";

/* ------------------------------------------------------------------ collection */

const suite = (name, parent) => ({
  name,
  parent,
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
  // Set once the suite's beforeAll has run (with whatever it threw), and counted
  // down as its tests finish so afterAll fires after the last one.
  entered: false,
  enterError: null,
  remaining: 0,
});

const root = suite("", null);
let current = root;
const queue = [];
let scheduled = false;

/** Register the whole file's tests once its body has finished evaluating. */
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

export function describe(name, fn) {
  const child = suite(name, current);
  const parent = current;
  current = child;
  try {
    fn();
  } finally {
    current = parent;
  }
}

export function test(name, fn) {
  queue.push({ suite: current, name, fn });
  for (let s = current; s; s = s.parent) s.remaining++;
  schedule();
}

export const beforeAll = (fn) => void current.beforeAll.push(fn);
export const afterAll = (fn) => void current.afterAll.push(fn);
export const beforeEach = (fn) => void current.beforeEach.push(fn);
export const afterEach = (fn) => void current.afterEach.push(fn);

/* ------------------------------------------------------------------- execution */

/** The suite chain from the outermost describe inwards. */
function ancestry(s) {
  const chain = [];
  for (let cur = s; cur; cur = cur.parent) chain.unshift(cur);
  return chain;
}

const runHooks = async (hooks) => {
  for (const hook of hooks) await hook();
};

function flush() {
  // Each test waits on the previous one's gate, so the file is sequential even though
  // the runtime starts them all at once.
  let gate = Promise.resolve();

  for (const { suite: owner, name, fn } of queue) {
    const previous = gate;
    let open;
    gate = new Promise((resolve) => (open = resolve));
    const chain = ancestry(owner);
    const label = chain
      .map((s) => s.name)
      .filter(Boolean)
      .concat(name)
      .join(" › ");

    rtTest(label, async () => {
      await previous;
      try {
        await runTest(chain, fn);
      } finally {
        open();
      }
    });
  }
}

async function runTest(chain, fn) {
  for (const s of chain) {
    if (!s.entered) {
      s.entered = true;
      try {
        await runHooks(s.beforeAll);
      } catch (e) {
        s.enterError = e;
      }
    }
    // Every test in the suite fails the same way, rather than the first one carrying
    // the real error and the rest failing on whatever the setup never created.
    if (s.enterError) throw s.enterError;
  }

  let failure = null;
  try {
    for (const s of chain) await runHooks(s.beforeEach);
    await fn();
  } catch (e) {
    failure = e;
  }

  for (const s of [...chain].reverse()) {
    try {
      await runHooks(s.afterEach);
    } catch (e) {
      failure ??= e;
    }
  }

  // afterAll belongs to the last test of the suite — innermost first, so a nested
  // suite tears down before the one that set up around it.
  for (const s of [...chain].reverse()) {
    if (--s.remaining > 0) continue;
    try {
      await runHooks(s.afterAll);
    } catch (e) {
      failure ??= e;
    }
  }

  if (failure) throw failure;
}

/* -------------------------------------------------------------------- matchers */

/** A short, readable rendering of a value for a failure message. */
function show(v) {
  if (typeof v === "string") return JSON.stringify(v.length > 300 ? `${v.slice(0, 300)}…` : v);
  if (typeof v === "bigint") return `${v}n`;
  if (v instanceof RegExp || typeof v === "function") return String(v);
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return String(v);
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return String(a) === String(b);
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  if (a instanceof Map) {
    return a.size === b.size && [...a].every(([k, v]) => b.has(k) && deepEqual(v, b.get(k)));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
}

// Each matcher reports what it wanted and what it got; `not` flips the check and the
// wording, so a negated failure reads "expected not to contain" rather than inverted
// nonsense. `describe` gets the noun, `check` the predicate.
const MATCHERS = {
  toBe: { describe: (e) => `to be ${show(e)}`, check: (a, e) => Object.is(a, e) },
  toEqual: { describe: (e) => `to equal ${show(e)}`, check: deepEqual },
  toBeNull: { describe: () => "to be null", check: (a) => a === null },
  toBeUndefined: { describe: () => "to be undefined", check: (a) => a === undefined },
  toBeTruthy: { describe: () => "to be truthy", check: (a) => Boolean(a) },
  toBeFalsy: { describe: () => "to be falsy", check: (a) => !a },
  toBeLessThan: { describe: (e) => `to be less than ${show(e)}`, check: (a, e) => a < e },
  toBeGreaterThan: { describe: (e) => `to be greater than ${show(e)}`, check: (a, e) => a > e },
  toHaveLength: { describe: (e) => `to have length ${e}`, check: (a, e) => a?.length === e },
  toContain: {
    describe: (e) => `to contain ${show(e)}`,
    check: (a, e) => (typeof a === "string" ? a.includes(e) : Array.from(a ?? []).includes(e)),
  },
  toMatch: {
    describe: (e) => `to match ${show(e)}`,
    check: (a, e) => (typeof e === "string" ? String(a).includes(e) : e.test(String(a))),
  },
};

function bind(actual, negated) {
  const api = {};
  for (const [name, { describe: what, check }] of Object.entries(MATCHERS)) {
    api[name] = (expected) => {
      let ok;
      try {
        ok = Boolean(check(actual, expected));
      } catch {
        ok = false; // a matcher that can't inspect the value has not matched it
      }
      if (ok === negated) {
        throw new Error(`expected ${show(actual)} ${negated ? "not " : ""}${what(expected)}`);
      }
    };
  }
  return api;
}

export function expect(actual) {
  const api = bind(actual, false);
  api.not = bind(actual, true);
  return api;
}
