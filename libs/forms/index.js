import { signal, effect, computed, batch } from "@preact/signals-core";

/**
 * Helper to set a nested property in an object.
 */
const setPath = (obj, path, value) => {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = parts[i + 1];
    if (!current[part]) {
      current[part] = !isNaN(next) ? [] : {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
};

/**
 * Creates a reactive form state manager.
 */
export function createForm({ initialValues = {}, validate, schema, resolver } = {}) {
  const fields = {}; // Stores field signals by path
  const fieldPaths = signal([]); // Track list of paths for computed to depend on

  function ensureField(path, initVal) {
    if (!fields[path]) {
      fields[path] = signal(initVal === undefined ? "" : initVal);
    }
    if (!fieldPaths.value.includes(path)) {
      fieldPaths.value = [...fieldPaths.value, path];
    }
    if (initVal !== undefined) {
      fields[path].value = initVal;
    }
    return fields[path];
  }

  const walk = (obj, path = "") => {
    if (obj && typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach(key => {
        const fullPath = path ? `${path}.${key}` : key;
        walk(obj[key], fullPath);
      });
    } else if (path) {
      ensureField(path, obj);
    }
  };

  // Initial population
  batch(() => walk(initialValues));

  // Computed state object
  const values = computed(() => {
    const res = {};
    // By reading fieldPaths.value, this computed re-runs when fields are added
    fieldPaths.value.forEach(path => {
      setPath(res, path, fields[path].value);
    });
    return res;
  });

  const errors = signal({});

  // Reactive validation
  effect(() => {
    const currentValues = values.value;
    if (resolver) {
      const result = resolver(currentValues, schema);
      errors.value = result.errors || {};
    } else if (validate) {
      errors.value = validate(currentValues) || {};
    }
  });

  function register(name) {
    const s = ensureField(name);
    return {
      name,
      value: s, 
      oninput: (e) => {
        s.value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      }
    };
  }

  function handleSubmit(onSubmit) {
    return (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const currentValues = values.value;
      let currentErrors = {};
      if (resolver) {
        currentErrors = resolver(currentValues, schema).errors || {};
      } else if (validate) {
        currentErrors = validate(currentValues) || {};
      }
      errors.value = currentErrors;
      if (Object.keys(currentErrors).length === 0) {
        onSubmit(currentValues);
      }
    };
  }

  function setValues(newValues) {
    batch(() => {
      // Identify all current paths that start with the keys being updated
      const keysToUpdate = Object.keys(newValues);
      const remainingPaths = fieldPaths.value.filter(path => {
        return !keysToUpdate.some(k => path === k || path.startsWith(k + "."));
      });
      
      // Remove those paths from fieldPaths so walk can re-add them
      fieldPaths.value = remainingPaths;
      
      walk(newValues);
    });
  }

  /**
   * Returns a reactive signal for an array at the given path.
   * Useful for high-performance keyed list rendering.
   */
  function array(path) {
    return computed(() => values.value[path] || []);
  }

  return {
    register,
    handleSubmit,
    setValues,
    getValues: () => values.value,
    array,
    // Proxy delegates to the computed values.value
    values: new Proxy({}, {
      get: (_, key) => values.value[key],
      set: (_, key, val) => {
        setValues({ [key]: val });
        return true;
      },
      ownKeys: (_) => Object.keys(values.value),
      getOwnPropertyDescriptor: (_, key) => {
        const val = values.value[key];
        return val !== undefined ? {
          enumerable: true,
          configurable: true,
          value: val,
          writable: true
        } : undefined;
      },
      defineProperty: (_, key, desc) => {
        if (desc.value !== undefined) {
          setValues({ [key]: desc.value });
        }
        return true;
      },
      deleteProperty: (_, key) => {
        // Handle deletion if needed, but for now just return true
        return true;
      }
    }),
    errors
  };
}
