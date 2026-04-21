import { effect } from "@preact/signals-core";

export function renderDynamic(parent, fn) {
  const anchor = document.createComment("dynamic");
  parent.appendChild(anchor);
  
  let currentNodes = [];
  
  effect(() => {
    let value = fn();
    // If the value is a function (e.g., from mapped), execute it to get the nodes
    if (typeof value === "function") value = value();
    
    if (value === null || value === undefined || value === false) value = [];
    if (!Array.isArray(value)) value = [value];

    const nextNodes = value.map(v => {
      if (v instanceof Node) return v;
      return document.createTextNode(String(v));
    });

    reconcile(anchor.parentNode, anchor, currentNodes, nextNodes);
    currentNodes = nextNodes;
  });
}

export function mapped(signal, fn) {
  let cache = new Map(); // key -> { node, effect }
  
  return () => {
    const list = signal.value || [];
    const nextNodes = [];
    const nextCache = new Map();

    list.forEach((item, index) => {
      const key = item.key ?? item.id ?? index;
      let cached = cache.get(key);
      
      if (cached) {
        nextNodes.push(cached.node);
        nextCache.set(key, cached);
      } else {
        const node = fn(item, index);
        node._key = key;
        nextNodes.push(node);
        nextCache.set(key, { node });
      }
    });

    // Cleanup removed items
    cache.forEach((cached, key) => {
      if (!nextCache.has(key)) {
        if (cached.node.remove) cached.node.remove();
      }
    });

    cache = nextCache;
    return nextNodes;
  };
}

function reconcile(parent, anchor, oldNodes, nextNodes) {
  // Clear old nodes and append new ones for now to ensure correctness
  // Full reconciliation with node reuse requires signal-based item updates
  oldNodes.forEach(n => n.remove());
  nextNodes.forEach(n => parent.insertBefore(n, anchor));
}
