import { effect, isSSG } from "../core/signals.js";

let currentInstance = null;

export function withInstance(inst, fn) {
  const prev = currentInstance;
  currentInstance = inst;
  let prevWalker = null;
  if (inst && typeof inst.hasAttribute === 'function') {
    prevWalker = inst._walker;
    if (inst.hasAttribute('data-ssg') && !inst._walker) {
      inst._walker = document.createTreeWalker(inst, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      // Skip the root element itself
      inst._walker.nextNode();
    }
  }
  try {
    return fn();
  } finally {
    currentInstance = prev;
    if (inst) inst._walker = prevWalker;
  }
}

export function getCurrentInstance() {
  return currentInstance;
}

export function onMount(fn) {
  if (isSSG) return;
  if (currentInstance) {
    if (!currentInstance._onMounts) {
       Object.defineProperty(currentInstance, "_onMounts", { value: [], enumerable: false, writable: true, configurable: true });
    }
    currentInstance._onMounts.push(fn);
  }
}

export function onUnmount(fn) {
  if (isSSG) return;
  if (currentInstance) {
    if (!currentInstance._onCleanups) {
       Object.defineProperty(currentInstance, "_onCleanups", { value: [], enumerable: false, writable: true, configurable: true });
    }
    currentInstance._onCleanups.push(fn);
  }
}

export function onCleanup(fn) {
  return onUnmount(fn);
}

export function hookEffect(fn) {
  const disposer = effect(fn);
  if (currentInstance) {
    if (!currentInstance._effectFactories) {
      Object.defineProperty(currentInstance, "_effectFactories", { value: [], enumerable: false, writable: true, configurable: true });
    }
    currentInstance._effectFactories.push(fn);
    onUnmount(disposer);
  }
  return disposer;
}

export function _disconnectWafComponent(el) {
  if (el._onCleanups) {
    el._onCleanups.forEach(fn => {
      try {
        fn();
      } catch (e) {}
    });
    el._onCleanups = [];
  }
}

export function _reconnectWafComponent(el) {
  if (el._mounted) {
    withInstance(el, () => {
      if (el._effectFactories) {
        el._effectFactories.forEach(fn => {
          const disposer = effect(fn);
          onUnmount(disposer);
        });
      }
      if (el._children) {
        el._children.forEach(child => {
          if (!el.contains(child)) el.appendChild(child);
        });
      }
      if (el._onMounts) {
        el._onMounts.forEach(fn => fn());
      }
    });
  }
}

import { _defineWafProps } from "./props.js";

export function _initInternalState(el, propsSignals) {
  Object.defineProperties(el, {
    _propsSignals: { value: propsSignals || {}, enumerable: false, writable: true, configurable: true },
    _onMounts: { value: [], enumerable: false, writable: true, configurable: true },
    _onCleanups: { value: [], enumerable: false, writable: true, configurable: true },
    _children: { value: [], enumerable: false, writable: true, configurable: true },
    _mounted: { value: false, enumerable: false, writable: true, configurable: true }
  });
}

// Metadata initializer for Web Components
export function _initWafComponent(el) {
  _initInternalState(el, el._propsSignals);
  _defineWafProps(el.constructor);
  return el;
}
