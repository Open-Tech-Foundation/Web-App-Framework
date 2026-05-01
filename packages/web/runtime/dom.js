import { effect, signal } from "@preact/signals-core";

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

export function _mapped(source, fn) {
  let cache = new Map(); // key -> { node, itemSignal, indexSignal }
  
  return () => {
    const list = (typeof source === "function" ? source() : source.value) || [];
    const nextNodes = [];
    const nextCache = new Map();

    list.forEach((item, index) => {
      const key = item.key ?? item.id ?? index;
      let cached = cache.get(key);
      
      if (cached) {
        // Reuse node and update signals
        cached.itemSignal.value = item;
        cached.indexSignal.value = index;
        nextNodes.push(cached.node);
        nextCache.set(key, cached);
      } else {
        // Create new node and signals
        const itemSignal = signal(item);
        const indexSignal = signal(index);
        const node = fn(itemSignal, indexSignal);
        node._key = key;
        nextNodes.push(node);
        nextCache.set(key, { node, itemSignal, indexSignal });
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
