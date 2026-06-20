import * as Signals from "@preact/signals-core";

if (typeof window !== 'undefined') {
  if (globalThis.__WAF_SIGNALS_LOADED__) {
    console.warn("@opentf/web: Multiple instances of signals detected! This may cause reactivity loss.");
  }
  globalThis.__WAF_SIGNALS_LOADED__ = true;
}

// ─── SSG Detection ───
export const PREACT_SIGNALS_BRAND = Symbol.for("preact-signals");
export let isSSG = false;
try {
  isSSG = typeof globalThis !== 'undefined' && globalThis.__WAF_SSG__ === true;
} catch (e) {}

export function _setSSG(val) { isSSG = val; }

// ─── Framework Reactive Core ───
export const signal = (val) => {
  if (isSSG) {
    return {
      brand: Symbol.for("preact-signals"),
      _v: val,
      get value() { return this._v; },
      set value(v) { this._v = v; },
      peek: () => val,
      subscribe: () => () => {}
    };
  }
  return Signals.signal(val);
};

export const computed = (fn) => {
  if (isSSG) {
    return {
      brand: Symbol.for("preact-signals"),
      get value() { return fn(); },
      peek: () => fn(),
      subscribe: () => () => {}
    };
  }
  return Signals.computed(fn);
};

export const effect = (fn) => {
  if (isSSG) {
    try { fn(); } catch (e) {}
    return () => {};
  }
  return Signals.effect(fn);
};

export const batch = (fn) => Signals.batch(fn);
export const untracked = (fn) => Signals.untracked(fn);

export const Signal = Signals.Signal;
export const Computed = Signals.Computed;
export const Effect = Signals.Effect;
