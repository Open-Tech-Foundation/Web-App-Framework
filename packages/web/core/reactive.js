//! Deep reactive store — a fine-grained, signal-backed reactive object.
//
// `reactive(obj)` returns a deep proxy over plain data. Reading a property
// inside an effect/computed subscribes to *just that path*; writing a property
// notifies *only* the effects that read it. Object/array nodes are wrapped
// lazily on access, so a 100-field store costs nothing until a field is touched.
//
// This is the public primitive SPEC §1.1 requires to live in `@opentf/web`:
// apps `import { reactive }` and read values directly (no provider object), and
// `@opentf/web-form` builds its values/errors trees on top of it instead of a
// private proxy. It is forward-compatible with the `$signal()` compiler bridge
// (SPEC §3.5): each node is itself reactive, so a future First-Access unwrap can
// read `store.user.value` without changing this runtime.
//
// Model (mirrors the signals core, one level up):
//   - per *key* signal  → fine-grained leaf subscription (read `a.b.c`)
//   - per *node* "struct" signal → bumped on key add/remove so `in`, `ownKeys`,
//     iteration and array `length` stay reactive.
// State is mutated in place (the store owns it); reads always go through the
// proxy, so callers never observe the raw object directly. No per-write tree
// clone, no broadcast — the two costs the old form proxy paid on every keystroke.

import { signal, untracked, batch } from "./signals.js";

/** Unwrap a reactive proxy back to its underlying plain object. */
const RAW = Symbol.for("otfw.reactive.raw");
/** Brand a proxy so `isReactive` is a cheap, collision-free check. */
const IS_REACTIVE = Symbol.for("otfw.reactive.is");

// Per raw-object bookkeeping, kept off the data itself so the data stays clean.
const proxyCache = new WeakMap(); // raw object  → its proxy (stable identity)
const keySignals = new WeakMap(); // raw object  → Map<key, signal(value)>
const structSignals = new WeakMap(); // raw object → signal(int) bumped on shape change

// Array methods that mutate in place; routed through a `batch` so the many
// internal index/length writes collapse into a single notification.
const ARRAY_MUTATORS = new Set([
  "push", "pop", "shift", "unshift", "splice", "reverse", "sort", "fill", "copyWithin",
]);

/** Only plain objects and arrays are wrapped; class instances, Dates, etc. pass through. */
function isWrappable(v) {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function getKeySig(target, key) {
  let map = keySignals.get(target);
  if (!map) keySignals.set(target, (map = new Map()));
  let sig = map.get(key);
  if (!sig) map.set(key, (sig = signal(target[key])));
  return sig;
}

function getStructSig(target) {
  let sig = structSignals.get(target);
  if (!sig) structSignals.set(target, (sig = signal(0)));
  return sig;
}

/** Strip a reactive wrapper from a value before it is stored. */
function toRaw(v) {
  return v && typeof v === "object" && v[RAW] !== undefined ? v[RAW] : v;
}

const handler = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    if (key === IS_REACTIVE) return true;

    if (typeof key === "symbol") {
      // Spreading/iterating walks length+indices through the proxy, but the
      // iterator lookup itself should subscribe to shape so a re-spread re-runs.
      if (key === Symbol.iterator) getStructSig(target).value;
      return Reflect.get(target, key, receiver);
    }

    // `length` is structural for arrays — push/splice change it.
    if (key === "length" && Array.isArray(target)) {
      getStructSig(target).value;
      return target.length;
    }

    const value = target[key];

    if (typeof value === "function") {
      if (Array.isArray(target)) {
        // Mutators re-enter the `set` trap via `receiver`; batch their internal
        // writes so an effect re-runs once.
        if (ARRAY_MUTATORS.has(key)) {
          return (...args) => batch(() => value.apply(receiver, args));
        }
        // Read methods (map/filter/forEach/…) subscribe to *structure* only and
        // run over the raw array, so they re-run when the list grows/shrinks but
        // not when an individual element's value changes. This is what keeps a
        // `list.map(i => <input/>)` from re-rendering (and dropping focus) on
        // every keystroke — the element's own binding handles its value.
        getStructSig(target).value;
        return value.bind(target);
      }
      return value.bind(receiver);
    }

    getKeySig(target, key).value; // subscribe to this leaf/branch
    return isWrappable(value) ? wrap(value) : value;
  },

  set(target, key, value) {
    const raw = toRaw(value);

    if (key === "length" && Array.isArray(target)) {
      if (target.length !== raw) {
        target.length = raw;
        getStructSig(target).value++;
      }
      return true;
    }

    const had = Object.prototype.hasOwnProperty.call(target, key);
    if (had && Object.is(target[key], raw)) return true;

    target[key] = raw;
    const map = keySignals.get(target);
    const sig = map && map.get(key);
    if (sig) sig.value = raw; // notify only if someone is listening
    if (!had) getStructSig(target).value++; // new key → shape changed
    return true;
  },

  deleteProperty(target, key) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) return true;
    delete target[key];
    const map = keySignals.get(target);
    const sig = map && map.get(key);
    if (sig) sig.value = undefined;
    getStructSig(target).value++;
    return true;
  },

  has(target, key) {
    getStructSig(target).value;
    return Reflect.has(target, key);
  },

  ownKeys(target) {
    getStructSig(target).value;
    return Reflect.ownKeys(target);
  },
};

function wrap(target) {
  const cached = proxyCache.get(target);
  if (cached) return cached;
  const proxy = new Proxy(target, handler);
  proxyCache.set(target, proxy);
  return proxy;
}

/**
 * Create a deep reactive store over a plain object/array. Property reads inside
 * an effect subscribe fine-grained; writes (`s.a.b = x`, `s.items.push(y)`)
 * notify only dependents of the touched paths.
 */
export function reactive(init = {}) {
  if (!isWrappable(init)) {
    throw new TypeError("reactive() expects a plain object or array");
  }
  return wrap(init);
}

/** Whether `v` is a store created by `reactive()`. */
export function isReactive(v) {
  return !!(v && typeof v === "object" && v[IS_REACTIVE]);
}

/** The underlying plain object of a store (live, not a copy); identity for non-stores. */
export function toRawValue(v) {
  return isReactive(v) ? v[RAW] : v;
}

/**
 * A plain, non-reactive deep copy of a store's current value — for submit
 * payloads, validation input, or persistence. Reads are untracked, so taking a
 * snapshot never subscribes the caller.
 */
export function snapshot(v) {
  return untracked(() => structuredClone(toRawValue(v)));
}
