import { signal, untracked, Signal, PREACT_SIGNALS_BRAND } from "../core/signals.js";
const PROPS_SET = new WeakMap();
const PROPS_SUBS = new WeakMap();

export function createPropsProxy(el) {
  if (!el._propsSignals) {
    Object.defineProperty(el, "_propsSignals", { value: {}, enumerable: false, writable: true, configurable: true });
  }
  if (!PROPS_SET.has(el)) {
    PROPS_SET.set(el, new Set());
  }
  const propsSet = PROPS_SET.get(el);
  
  const target = { _el: el };
  
  return new Proxy(target, {
    get: (t, key) => {
      if (key === "__signals") return el._propsSignals;
      if (key in t && typeof t[key] === "function") return t[key];
      
      if (key === "children") {
        const sig = el._propsSignals?.children;
        if (sig && typeof sig === "object" && "value" in sig) return sig.value;
        return el._children;
      }
      if (typeof key === "symbol" || key.startsWith("_")) return el[key];
      if (key === "then") return undefined; // Promise check
      
      propsSet.add(key);
      const sig = el._propsSignals ? el._propsSignals[key] : undefined;
      if (sig) return sig;
      
      const val = (el[key] !== undefined)
        ? el[key]
        : (typeof el.getAttribute === "function" ? el.getAttribute(key) : undefined);
      
      if (typeof val === "function" || key.startsWith("on")) {
        t[key] = val;
        return val;
      }

      // Create signal lazily if not already there
      el._propsSignals[key] = signal(val);
      return el._propsSignals[key];
    },
    set: (t, key, value) => {
      t[key] = value;
      if (typeof key === "symbol" || key.startsWith("_") || key.startsWith("on")) {
        propsSet.add(key);
        if (key.startsWith("on")) console.log(`@opentf/web: Proxy SET event ${key} on`, el.tagName);
        el[key] = value;
        return true;
      }

      const isSignal = value && typeof value === "object" && (value instanceof Signal || value.brand === PREACT_SIGNALS_BRAND || PREACT_SIGNALS_BRAND in value);
      
      untracked(() => {
        propsSet.add(key);
        if (!el._propsSignals) {
          Object.defineProperty(el, "_propsSignals", { value: {}, enumerable: false, writable: true, configurable: true });
        }
        
        if (!el._propsSignals[key]) {
          el._propsSignals[key] = isSignal ? value : signal(value);
        }

        const sig = el._propsSignals[key];

        let subs = PROPS_SUBS.get(el);
        if (!subs) {
          subs = {};
          PROPS_SUBS.set(el, subs);
        }
        if (subs[key]) {
          subs[key]();
          delete subs[key];
        }
        
        if (isSignal) {
          subs[key] = value.subscribe(v => {
            if (!el._propsSignals[key]) {
              el._propsSignals[key] = signal(v);
            } else if (el._propsSignals[key].value !== v) {
              el._propsSignals[key].value = v;
            }
          });
        } else {
          if (!el._propsSignals[key]) {
            el._propsSignals[key] = signal(value);
          } else if (el._propsSignals[key].value !== value) {
            el._propsSignals[key].value = value;
          }
        }

        if (key === "children") {
          el._children = isSignal ? value.peek() : value;
        }
      });
      
      return true;
    },
    ownKeys: (t) => {
      const keys = new Set(propsSet);
      keys.add("children");
      // Add observed attributes if any
      const observed = el.constructor?.observedAttributes;
      if (Array.isArray(observed)) {
        observed.forEach(k => keys.add(k));
      }
      return Array.from(keys);
    },
    getOwnPropertyDescriptor: (t, key) => {
      if (propsSet.has(key) || key === 'children' || (Array.isArray(el.constructor?.observedAttributes) && el.constructor.observedAttributes.includes(key))) {
        return { enumerable: true, configurable: true, writable: true };
      }
      return undefined;
    }
  });
}

export function _syncPropGet(el, key) {
  if (!el._propsSignals) return undefined;
  const sig = el._propsSignals[key];
  return sig ? sig.value : undefined;
}

export function _syncPropSet(el, key, val) {
  if (!el._propsSignals) {
    Object.defineProperty(el, "_propsSignals", { value: {}, enumerable: false, writable: true, configurable: true });
  }
  if (!el._propsSignals[key]) {
    el._propsSignals[key] = signal(val);
  }
  el._propsSignals[key].value = val;
}

export function _defineWafProps(ctor) {
  const attrs = ctor.observedAttributes;
  if (!attrs) return;
  attrs.forEach(attr => {
    if (attr in ctor.prototype) return;
    Object.defineProperty(ctor.prototype, attr, {
      get() { return _syncPropGet(this, attr); },
      set(val) { _syncPropSet(this, attr, val); },
      enumerable: true,
      configurable: true
    });
  });
}
