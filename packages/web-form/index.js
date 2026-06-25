import {
  signal,
  computed,
  effect,
  batch,
  untracked,
  getCurrentInstance,
  reactive,
  toRawValue,
  snapshot,
} from "@opentf/web";

export { signal, computed, batch, effect, untracked, reactive, getCurrentInstance };

import { clone, isEql } from "@opentf/std";

/**
 * Path-based reactive forms engine for OTF Web.
 *
 * The form's values/errors/touched/changed trees are `reactive()` stores
 * (@opentf/web), so `form.values.user.name` and `form.errors.email` are read
 * directly in JSX with fine-grained reactivity — no provider object, no bespoke
 * proxy. The engine layers field registration, validation modes, and submit
 * orchestration on top.
 */

const INST_FORMS_REGISTRY = new WeakMap();

export function createForm(options = {}) {
  // Scope the form to the mounting component so re-entrant `createForm` calls
  // (e.g. the component body running again) return the same instance. Outside a
  // component (module scope, tests) there is no instance — just build one.
  const inst = getCurrentInstance();
  if (!inst) return _createForm(options);

  let forms = INST_FORMS_REGISTRY.get(inst);
  if (!forms) INST_FORMS_REGISTRY.set(inst, (forms = new Map()));

  const key = options.key || JSON.stringify({ initialValues: options.initialValues });
  if (forms.has(key)) {
    const form = forms.get(key);
    form._updateConfig?.(options.mode, options.reValidateMode);
    return form;
  }
  const form = _createForm(options);
  forms.set(key, form);
  return form;
}

function _createForm(options = {}) {
  let initialValues = clone(options.initialValues || {});

  const valuesStore = reactive(clone(initialValues));
  const errorsStore = reactive({});
  // touched mirrors the value tree with `false` leaves, so a field reads `false`
  // (not undefined) before it is ever blurred. `changed` is filled by the
  // creation effect below (top-level booleans vs. initial values).
  const touchedStore = reactive(mirrorLeaves(initialValues, false));
  const changedStore = reactive({});

  const modeSig = signal(options.mode);
  const reValidateModeSig = signal(options.reValidateMode);
  const isSubmittingSig = signal(false);
  const isValidatingSig = signal(false);
  const isSubmittedSig = signal(false);
  const submitCountSig = signal(0);

  const normMode = (m) =>
    ((m && typeof m === "object" && "value" in m ? m.value : m) || "onBlur");
  const normReValidate = (m) =>
    ((m && typeof m === "object" && "value" in m ? m.value : m) || "onChange");

  const activeValidator = options.validator || options.validate;

  // --- path helpers: walk the reactive store so reads subscribe & writes notify
  function readPath(store, path) {
    if (!path) return store;
    let node = store;
    for (const p of path.split(".")) {
      if (node == null) return undefined;
      node = node[p];
    }
    return node;
  }

  function writePath(store, path, value) {
    const parts = path.split(".");
    let node = store;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      let next = node[p];
      if (next == null || typeof next !== "object") {
        node[p] = {};
        next = node[p];
      }
      node = next;
    }
    node[parts[parts.length - 1]] = value;
  }

  function deletePath(store, path) {
    const parts = path.split(".");
    let node = store;
    for (let i = 0; i < parts.length - 1; i++) {
      node = node[parts[i]];
      if (node == null || typeof node !== "object") return;
    }
    delete node[parts[parts.length - 1]];
  }

  // Reconcile a reactive store in place to match a plain object, touching only
  // the leaves that actually differ (fine-grained — no wholesale replace).
  function syncStore(store, next) {
    next = next || {};
    const raw = toRawValue(store);
    for (const k of Object.keys(raw)) {
      if (!(k in next)) delete store[k];
    }
    for (const k of Object.keys(next)) {
      const nv = next[k];
      const cur = raw[k];
      if (nv && typeof nv === "object" && cur && typeof cur === "object") {
        syncStore(store[k], nv);
      } else if (!isEql(cur, nv)) {
        store[k] = nv;
      }
    }
  }

  // --- validation
  const normalizeErrors = (r) => (r && r.errors !== undefined ? r.errors : r) || {};

  function applyErrors(errorsObj, fieldPath) {
    if (fieldPath) {
      const fieldErr = readRaw(errorsObj, fieldPath);
      if (fieldErr) writePath(errorsStore, fieldPath, fieldErr);
      else deletePath(errorsStore, fieldPath);
    } else {
      syncStore(errorsStore, errorsObj);
    }
  }

  let validationToken = 0;
  function runValidation(fieldPath) {
    if (!activeValidator) return;
    const token = ++validationToken;
    const result = activeValidator(snapshot(valuesStore));
    if (result instanceof Promise) {
      isValidatingSig.value = true;
      return result
        .then((r) => {
          if (token === validationToken) applyErrors(normalizeErrors(r), fieldPath);
        })
        .finally(() => {
          if (token === validationToken) isValidatingSig.value = false;
        });
    }
    applyErrors(normalizeErrors(result), fieldPath);
  }

  // --- changed tracking: per top-level key, deep-compared to initial values.
  function recomputeChanged() {
    const v = toRawValue(valuesStore);
    const keys = new Set([...Object.keys(v), ...Object.keys(initialValues)]);
    for (const k of keys) {
      const ch = !isEql(v[k], initialValues[k]);
      if (toRawValue(changedStore)[k] !== ch) changedStore[k] = ch;
    }
  }

  // One effect observes every value change and (a) recomputes `changed`, and
  // (b) in onChange mode, revalidates — covering inputs, direct assignment, and
  // array mutation alike. Writes are untracked so it never depends on its own
  // output. Validates once on creation, satisfying onChange's "validate on init".
  effect(() => {
    deepTrack(valuesStore);
    const mode = normMode(modeSig.value);
    untracked(() => {
      recomputeChanged();
      if (mode === "onChange") runValidation();
    });
  });

  // --- field registration
  function updateValue(path, val) {
    writePath(valuesStore, path, val);
    const mode = normMode(modeSig.peek());
    if (mode === "onChange") return; // the effect above revalidates
    if (hasTruthy(toRawValue(errorsStore)) && normReValidate(reValidateModeSig.peek()) === "onChange") {
      runValidation(path);
    }
  }

  const register = (path) => ({
    name: path,
    value: readPath(valuesStore, path),
    checked: readPath(valuesStore, path),
    error: computed(() => readPath(errorsStore, path)),
    isTouched: computed(() => readPath(touchedStore, path) ?? false),
    oninput: (e) => {
      const t = e.target;
      updateValue(path, t.type === "checkbox" ? t.checked : t.value);
    },
    onblur: () => {
      writePath(touchedStore, path, true);
      const mode = normMode(modeSig.peek());
      if (mode === "onBlur") runValidation(path);
      else if (
        hasTruthy(toRawValue(errorsStore)) &&
        normReValidate(reValidateModeSig.peek()) === "onBlur"
      ) {
        runValidation(path);
      }
    },
  });

  // --- submit / reset
  const handleSubmit = (fn) => async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    syncStore(touchedStore, mirrorLeaves(snapshot(valuesStore), true));
    isSubmittingSig.value = true;
    submitCountSig.value++;
    await runValidation();
    if (!hasTruthy(toRawValue(errorsStore))) {
      try {
        await fn(snapshot(valuesStore));
        isSubmittedSig.value = true;
      } finally {
        isSubmittingSig.value = false;
      }
    } else {
      isSubmittingSig.value = false;
    }
  };

  const reset = (newValues) => {
    batch(() => {
      if (newValues !== undefined) initialValues = clone(newValues);
      syncStore(valuesStore, clone(initialValues));
      syncStore(errorsStore, {});
      syncStore(touchedStore, mirrorLeaves(initialValues, false));
      syncStore(changedStore, {});
      isSubmittedSig.value = false;
    });
  };

  // --- derived flags
  const isValidSig = computed(() => !hasTruthy(errorsStore));
  const isTouchedSig = computed(() => hasTruthy(touchedStore));
  const isChangedSig = computed(() => hasTruthy(changedStore));

  const form = {
    register,
    handleSubmit,
    reset,
    _updateConfig(newMode, newReValidateMode) {
      batch(() => {
        modeSig.value = newMode;
        reValidateModeSig.value = newReValidateMode;
      });
    },
    _notifySignals() {}, // legacy no-op: reactive stores notify on write
    get values() { return valuesStore; },
    get errors() { return errorsStore; },
    get touched() { return touchedStore; },
    get changed() { return changedStore; },
    _signals: {
      values: storeSignal(valuesStore),
      errors: storeSignal(errorsStore),
      touched: storeSignal(touchedStore),
      changed: storeSignal(changedStore),
    },
  };

  Object.defineProperties(form, {
    isValid: { get: () => isValidSig.value, enumerable: true },
    isChanged: { get: () => isChangedSig.value, enumerable: true },
    isTouched: { get: () => isTouchedSig.value, enumerable: true },
    isSubmitting: { get: () => isSubmittingSig.value, enumerable: true },
    isValidating: { get: () => isValidatingSig.value, enumerable: true },
    isSubmitted: { get: () => isSubmittedSig.value, enumerable: true },
    submitCount: { get: () => submitCountSig.value, enumerable: true },
  });

  return form;
}

// --- shared helpers (no per-form state)

/** Raw (non-reactive) deep read by dot-path. */
function readRaw(obj, path) {
  let node = obj;
  for (const p of path.split(".")) {
    if (node == null) return undefined;
    node = node[p];
  }
  return node;
}

/** Whether any leaf is truthy — the basis of isValid/isTouched/isChanged. */
function hasTruthy(obj) {
  if (obj == null || typeof obj !== "object") return !!obj;
  return Object.values(obj).some(hasTruthy);
}

/** Mirror a tree's structure, replacing every leaf with `leaf`. */
function mirrorLeaves(obj, leaf) {
  if (obj == null || typeof obj !== "object") return leaf;
  const res = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) res[k] = mirrorLeaves(obj[k], leaf);
  return res;
}

/** Subscribe the active consumer to every path in a store (deep). */
function deepTrack(store) {
  const raw = toRawValue(store);
  if (raw == null || typeof raw !== "object") return;
  for (const k of Object.keys(store)) {
    const v = store[k];
    if (v && typeof v === "object") deepTrack(v);
  }
}

/**
 * A preact-style signal facade over a reactive store for the advanced `_signals`
 * API: `.value` snapshots/replaces the whole tree, `.subscribe(cb)` fires
 * immediately then once per change.
 */
function storeSignal(store) {
  return {
    get value() {
      return snapshot(store);
    },
    set value(v) {
      const next = v || {};
      const raw = toRawValue(store);
      for (const k of Object.keys(raw)) if (!(k in next)) delete store[k];
      for (const k of Object.keys(next)) store[k] = next[k];
    },
    peek() {
      return toRawValue(store);
    },
    subscribe(cb) {
      return effect(() => {
        deepTrack(store);
        cb(snapshot(store));
      });
    },
  };
}
