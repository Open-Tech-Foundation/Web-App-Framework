let currentInstance = null;
export const getCurrentInstance = () => currentInstance;

export function withInstance(inst, fn) {
  const prev = currentInstance;
  currentInstance = inst;
  try {
    return fn();
  } finally {
    currentInstance = prev;
  }
}

export function onMount(fn) {
  if (currentInstance) {
    if (!currentInstance._onMounts) currentInstance._onMounts = [];
    currentInstance._onMounts.push(fn);
  } else {
    // If no instance (like in a Page render), run immediately
    fn();
  }
}

export function onCleanup(fn) {
  if (currentInstance) {
    if (!currentInstance._onCleanups) currentInstance._onCleanups = [];
    currentInstance._onCleanups.push(fn);
  }
}
