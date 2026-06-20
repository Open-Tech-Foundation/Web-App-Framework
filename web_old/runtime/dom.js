import { signal, effect, isSSG, untracked, Signal, PREACT_SIGNALS_BRAND } from "../core/signals.js";
import { hookEffect, getCurrentInstance } from "./lifecycle.js";
import { IS_PROPERTY } from "../core/constants.js";

export function _element(tag) {
  const inst = getCurrentInstance();
  if (inst && inst._walker) {
    const node = inst._walker.currentNode;
    inst._walker.nextNode();
    return node;
  }
  return document.createElement(tag);
}

export function _text(content) {
  const inst = getCurrentInstance();
  if (inst && inst._walker) {
    const node = inst._walker.currentNode;
    inst._walker.nextNode();
    return node;
  }
  return document.createTextNode(content);
}

export function _svg(tag) {
  const inst = getCurrentInstance();
  if (inst && inst._walker) {
    const node = inst._walker.currentNode;
    inst._walker.nextNode();
    return node;
  }
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

export function _fragment() {
  return document.createDocumentFragment();
}

console.log("@opentf/web: dom.js loaded");

const ELEMENT_PROPS = new WeakMap();

export function applySpread(el, props, isComponent) {
  if (!props || typeof props !== 'object') return;
  
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let value = props[key];
    if (value && typeof value === 'object' && (value instanceof Signal || value.brand === PREACT_SIGNALS_BRAND || PREACT_SIGNALS_BRAND in value)) {
      value = value.value;
    }
    setProperty(el, key, value, isComponent);
  }
}

export function getWafProps(el) {
  return ELEMENT_PROPS.get(el);
}

export function _clearChildren(el) {
  if (isSSG) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setProperty(el, key, value, isComponent) {
  if (value && typeof value === 'object' && (value instanceof Signal || value.brand === PREACT_SIGNALS_BRAND || PREACT_SIGNALS_BRAND in value)) {
    value = value.value;
  }
  if (key === "style") {
    if (typeof value === "object") {
      Object.assign(el.style, value);
    } else {
      el.setAttribute("style", value);
    }
  } else if (key.startsWith("on") && typeof value === "function") {
    el[isComponent ? key : key.toLowerCase()] = value;
  } else if (IS_PROPERTY.includes(key)) {
    el[key] = value;
  } else {
    if (value === false || value === null || value === undefined) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, value);
    }
  }

  // Update signals if this is a WAF component
  if (el._propsSignals && !key.startsWith("on")) {
    untracked(() => {
      const sig = el._propsSignals[key];
      if (!sig) {
        el._propsSignals[key] = signal(value);
      } else if (sig && typeof sig === 'object' && 'value' in sig && sig.peek() !== value) {
        sig.value = value;
      }
    });
  }
}

export function renderDynamic(parent, fn) {
  const anchor = document.createTextNode("");
  parent.appendChild(anchor);

  let currentNodes = [];

  hookEffect(() => {
    let value = fn();
    if (value === undefined || value === null) value = [];
    const newNodes = (Array.isArray(value) ? value : [value])
      .map(node => {
        if (node === null || node === undefined || typeof node === 'boolean') return null;
        if (typeof node === 'function') node = node();
        if (node instanceof Node) return node;
        return document.createTextNode(String(node));
      })
      .filter(n => n !== null);
    
    // Remove nodes that are no longer present
    for (const node of currentNodes) {
      if (!newNodes.includes(node)) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    }

    // Insert or move nodes (backwards to ensure nextNode is always in DOM)
    for (let i = newNodes.length - 1; i >= 0; i--) {
      const node = newNodes[i];
      const nextNode = newNodes[i + 1] || anchor;
      if (node.nextSibling !== nextNode) {
        parent.insertBefore(node, nextNode);
      }
    }

    currentNodes = newNodes;
  });
}

export function _mapped(sourceFn, mapFn) {
  const cache = new Map();
  const result = signal([]);

  hookEffect(() => {
    const source = sourceFn();
    const data = Array.isArray(source) ? source : [];
    
    const newKeys = new Set();
    const newItems = data.map((item, index) => {
      const key = (item && typeof item === "object" && item.id !== undefined) ? item.id : index;
      newKeys.add(key);

      if (cache.has(key)) {
        const entry = cache.get(key);
        entry.sig.value = item;
        return entry.res;
      }

      const sig = signal(item);
      const res = mapFn(sig, index);
      cache.set(key, { sig, res });
      return res;
    });

    // Cleanup old cache entries
    for (const key of cache.keys()) {
      if (!newKeys.has(key)) cache.delete(key);
    }

    result.value = newItems;
  });

  return () => result.value;
}
