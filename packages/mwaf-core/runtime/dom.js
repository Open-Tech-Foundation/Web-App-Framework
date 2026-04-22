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

export function mapped(source, fn) {
  let cache = new Map(); // key -> { node }
  
  return () => {
    const list = (typeof source === "function" ? source() : source.value) || [];
    const nextNodes = [];
    const nextCache = new Map();

    list.forEach((item, index) => {
      const key = item.key ?? item.id ?? index;
      let cached = cache.get(key);
      
      // If the item exists and the reference is identical, reuse the node
      if (cached && cached.item === item) {
        nextNodes.push(cached.node);
        nextCache.set(key, cached);
      } else {
        // If it's a new item OR the data changed (new reference), re-render
        const node = fn(item, index);
        node._key = key;
        nextNodes.push(node);
        nextCache.set(key, { node, item });
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
  // 1. Remove nodes that are no longer present
  const nextSet = new Set(nextNodes);
  oldNodes.forEach(n => {
    if (!nextSet.has(n)) n.remove();
  });

  // 2. Insert or move nodes from right to left to minimize DOM operations
  let current = anchor;
  for (let i = nextNodes.length - 1; i >= 0; i--) {
    const node = nextNodes[i];
    if (node.nextSibling !== current) {
      parent.insertBefore(node, current);
    }
    current = node;
  }
}
