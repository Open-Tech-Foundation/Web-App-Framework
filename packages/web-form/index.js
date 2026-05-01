
import {
  signal,
  computed,
  batch,
  effect,
  untracked,
  getCurrentInstance,
} from "@opentf/web";

export { signal, computed, batch, effect, untracked, getCurrentInstance };

import { set, get, unset, clone, isEql } from "@opentf/std";

/**
 * Enterprise Form Reactivity Engine
 * 
 * Features:
 * - Mount-Aware Stability Cache
 * - Setup-Phase Subscription Isolation
 * - Deep Reactive Proxy with Array Mutation Support
 */

const INST_FORMS_REGISTRY = new WeakMap();
let isSetup = false;

export function createForm(options = {}) {
  const inst = getCurrentInstance();
  if (!inst) return _createForm(options);

  if (!INST_FORMS_REGISTRY.has(inst)) {
    INST_FORMS_REGISTRY.set(inst, new Map());
  }
  const forms = INST_FORMS_REGISTRY.get(inst);

  const key = options.key || JSON.stringify({
    initialValues: options.initialValues,
    mode: options.mode instanceof Object ? options.mode.value : options.mode,
    reValidateMode: options.reValidateMode instanceof Object ? options.reValidateMode.value : options.reValidateMode
  });
  
  if (forms.has(key)) {
    return forms.get(key);
  }

  isSetup = true;
  try {
    const form = _createForm(options);
    forms.set(key, form);
    return form;
  } finally {
    isSetup = false;
  }
}

function _createForm(options = {}) {
  const initialValuesSig = signal(clone(options.initialValues || {}));
  const valuesSig = signal(clone(initialValuesSig.value));
  const errorsSig = signal({});
  const touchedSig = signal({});
  const changedSig = signal({});
  const isSubmittingSig = signal(false);
  const isValidatingSig = signal(false);
  const isSubmittedSig = signal(false);
  const submitCountSig = signal(0);

  const signalsCache = new Map();

  function getSignal(sigType, path, defaultValue) {
    const key = `${sigType}:${path}`;
    if (signalsCache.has(key)) return signalsCache.get(key);
    const initialVal = get(
      sigType === "v" ? valuesSig.peek() : sigType === "e" ? errorsSig.peek() : sigType === "t" ? touchedSig.peek() : changedSig.peek(),
      path
    );
    const sig = signal(initialVal ?? defaultValue);
    signalsCache.set(key, sig);
    return sig;
  }

  function notifySignals(sigType) {
    const prefix = `${sigType}:`;
    const fullData = sigType === "v" ? valuesSig.peek() : sigType === "e" ? errorsSig.peek() : sigType === "t" ? touchedSig.peek() : changedSig.peek();
    
    for (const [cacheKey, sig] of signalsCache) {
      if (!cacheKey.startsWith(prefix)) continue;
      const path = cacheKey.slice(prefix.length);
      const newVal = path === "" ? fullData : get(fullData, path);
      sig.value = newVal;
    }
  }

  const getMode = () => untracked(() => (options.mode instanceof Object ? options.mode.value : options.mode) || "onBlur");
  const getReValidateMode = () => untracked(() => (options.reValidateMode instanceof Object ? options.reValidateMode.value : options.reValidateMode) || "onChange");
  const activeValidator = options.validator || options.validate;

  function hasErrors(obj) {
    if (!obj || typeof obj !== "object") return false;
    return Object.values(obj).some((v) => {
      if (v === undefined || v === null) return false;
      if (typeof v === "object") return hasErrors(v);
      return true;
    });
  }

  const isValidSig = computed(() => !hasErrors(errorsSig.value));
  const isTouchedSig = computed(() => hasErrors(touchedSig.value));
  const isDirtySig = computed(() => !isEql(valuesSig.value, initialValuesSig.value));

  function updateErrors(results, fieldPath) {
    const currentErrors = results && results.errors ? results.errors : results || {};
    if (fieldPath) {
      const fieldError = get(currentErrors, fieldPath);
      const newErrors = clone(errorsSig.value || {});
      if (fieldError) set(newErrors, fieldPath, fieldError);
      else unset(newErrors, fieldPath);
      errorsSig.value = newErrors;
    } else {
      errorsSig.value = currentErrors || {};
    }
    notifySignals("e");
  }

  function runValidation(fieldPath) {
    if (!activeValidator) return;

    const results = activeValidator(valuesSig.peek());
    if (results instanceof Promise) {
      isValidatingSig.value = true;
      return results.then((res) => updateErrors(res, fieldPath)).finally(() => isValidatingSig.value = false);
    }
    updateErrors(results, fieldPath);
  }

  function updateValue(path, val) {
    batch(() => {
      const newState = clone(valuesSig.peek());
      if (path === "") {
        valuesSig.value = clone(val);
      } else {
        set(newState, path, val);
        valuesSig.value = newState;
      }
      notifySignals("v");

      const isFieldChanged = !isEql(val, path === "" ? initialValuesSig.peek() : get(initialValuesSig.peek(), path));
      const newChanged = clone(changedSig.peek() || {});
      if (path === "") {
        // Root changed?
      } else {
        set(newChanged, path, isFieldChanged);
        changedSig.value = newChanged;
      }
      notifySignals("c");

      const mode = getMode();
      const hasAnyErrors = hasErrors(errorsSig.peek());
      const reValidateMode = getReValidateMode();

      if (mode === "onChange") runValidation(path);
      else if (hasAnyErrors && reValidateMode === "onChange") runValidation(path);
    });
  }
  const register = (path) => {
    const subSig = getSignal("v", path);
    return {
      name: path,
      value: getSafe(subSig),
      oninput: (e) => {
        const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
        updateValue(path, val);
      },
      onblur: () => {
        const newTouched = clone(touchedSig.value || {});
        set(newTouched, path, true);
        touchedSig.value = newTouched;
        notifySignals("t", path, touchedSig.value);
        if (getMode() === "onBlur") runValidation(path);
      },
    };
  };

  const handleSubmit = (fn) => async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    isSubmittingSig.value = true;
    submitCountSig.value++;
    await runValidation();
    if (isValidSig.value) {
      try { await fn(valuesSig.value); isSubmittedSig.value = true; }
      finally { isSubmittingSig.value = false; }
    } else {
      isSubmittingSig.value = false;
    }
  };

  const reset = (newValues) => {
    batch(() => {
      if (newValues !== undefined) initialValuesSig.value = clone(newValues);
      valuesSig.value = clone(initialValuesSig.value);
      errorsSig.value = {};
      touchedSig.value = {};
      changedSig.value = {};
      isSubmittedSig.value = false;
      notifySignals("v");
      notifySignals("e");
      notifySignals("t");
      notifySignals("c");
    });
  };

  const proxyCache = new Map();

  function createDeepProxy(sig, path = [], defaultValue = undefined) {

    const pathStr = path.join(".");
    // Use signal identity in cache key to avoid collisions between values/errors/etc.
    const sigKey = sig === valuesSig ? "v" : sig === errorsSig ? "e" : sig === touchedSig ? "t" : "c";
    const cacheKey = `${sigKey}:${pathStr}:${defaultValue}`;
    if (proxyCache.has(cacheKey)) return proxyCache.get(cacheKey);

    const val = untracked(() => (path.length === 0 ? sig.value : get(sig.value, pathStr)));

    const proxy = new Proxy(val || {}, {
      get(_, prop) {
        const latestVal = untracked(() => (path.length === 0 ? sig.value : get(sig.value, pathStr)));

        if (prop === Symbol.toStringTag) {
          return Array.isArray(latestVal) ? "Array" : "Object";
        }
        if (prop === "toJSON") {
          return () => (path.length === 0 ? sig.value : get(sig.value, pathStr));
        }
        if (prop === Symbol.iterator) {
          return latestVal[Symbol.iterator].bind(latestVal);
        }
        if (typeof prop === "symbol") return undefined;
        if (["__proto__", "constructor", "prototype"].includes(prop)) return undefined;

        const currentPathStr = pathStr ? `${pathStr}.${prop}` : prop;
        const value = latestVal ? latestVal[prop] : undefined;

        if (Array.isArray(latestVal) && ["push", "pop", "shift", "unshift", "splice", "reverse", "sort"].includes(prop)) {
          return (...args) => {
            const nextArr = [...latestVal];
            const result = nextArr[prop](...args);
            updateValue(pathStr, nextArr);
            return result;
          };
        }

        if (typeof value === "function") {
          return value.bind(latestVal);
        }

        // Subscribe to path-specific signal
        const subSig = getSignal(sigKey, currentPathStr, value ?? defaultValue);
        if (!isSetup) subSig.value;

        if (value && typeof value === "object") {
          return createDeepProxy(sig, [...path, prop], defaultValue);
        }

        return value ?? defaultValue;
      },
      set(_, prop, val) {

        const currentPathStr = [...path, prop].join(".");
        if (sig === valuesSig) updateValue(currentPathStr, val);
        else {
          const newState = clone(sig.value);
          set(newState, currentPathStr, val);
          sig.value = newState;
        }
        return true;
      },
      ownKeys() {
        const val = untracked(() => (path.length === 0 ? sig.value : get(sig.value, pathStr)));
        if (!isSetup) {
          const subSig = getSignal(sigKey, pathStr, val);
          subSig.value;
        }
        const keys = Object.keys(val || {});
        if (Array.isArray(val) && !keys.includes("length")) {
          keys.push("length");
        }
        return keys;
      },
      getOwnPropertyDescriptor(_, prop) {
        const latestVal = untracked(() => (path.length === 0 ? sig.value : get(sig.value, pathStr)));
        if (latestVal && typeof latestVal === "object" && prop in latestVal) {
          return Object.getOwnPropertyDescriptor(latestVal, prop);
        }
        return undefined;
      }
    });

    proxyCache.set(cacheKey, proxy);
    return proxy;
  }

  const form = {
    register,
    handleSubmit,
    reset,
    get values() { return createDeepProxy(valuesSig); },
    get errors() { return createDeepProxy(errorsSig); },
    get touched() { return createDeepProxy(touchedSig, [], false); },
    get changed() { return createDeepProxy(changedSig, [], false); },
    _signals: {
      values: valuesSig,
      errors: errorsSig,
      touched: touchedSig,
      changed: changedSig,
      initialValues: initialValuesSig,
    }
  };

  const getSafe = (sig) => (isSetup ? untracked(() => sig.value) : sig.value);

  Object.defineProperties(form, {
    isValid: { get: () => getSafe(isValidSig), enumerable: true },
    isChanged: { get: () => getSafe(isDirtySig), enumerable: true },
    isTouched: { get: () => getSafe(isTouchedSig), enumerable: true },
    isSubmitting: { get: () => getSafe(isSubmittingSig), enumerable: true },
    isValidating: { get: () => getSafe(isValidatingSig), enumerable: true },
    isSubmitted: { get: () => getSafe(isSubmittedSig), enumerable: true },
    submitCount: { get: () => getSafe(submitCountSig), enumerable: true },
  });

  // Initial validation (only if onChange mode)
  if (getMode() === "onChange") {
    runValidation();
  }

  return form;
}
