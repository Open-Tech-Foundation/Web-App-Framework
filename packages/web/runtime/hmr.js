// Imported only by development compiler output. The Custom Elements registry
// caches lifecycle callbacks at define time, so stable callbacks dispatch to the
// current implementation rather than redefining an existing tag.
import { scope } from "../core/signals.js";
import { refreshHotRoute } from "./router.js";

const components = new Map();

// The `$state` slots of the page/layout view currently being built.
let routeSlots = null;

/**
 * A page/layout `$state` signal kept in the view's refresh slots: a refresh of the
 * same view reuses the signal (and its value) when the state shape is unchanged.
 */
export function hotRouteState(key, create) {
  if (!routeSlots) return create();
  if (!routeSlots.has(key)) routeSlots.set(key, create());
  return routeSlots.get(key);
}

export function registerHotRoute(hot, factory, safe, shape = "") {
  if (!hot) return factory;
  if (!safe) {
    if (hot.data.otfwRouteBoundary) hot.invalidate();
    return factory;
  }
  hot.data.otfwRouteBoundary = true;
  const record = hot.keep("otfw-route", () => {
    const entry = { factory, shape };
    // `previous` is the view node this build replaces during a refresh. Its state
    // slots carry over when the declarations still match; otherwise state is fresh.
    entry.view = (props, previous) => {
      const kept = previous?.__otfwHotSlots;
      const slots = kept && kept.shape === entry.shape ? kept.slots : new Map();
      let failed = false, failure;
      const outer = routeSlots;
      routeSlots = slots;
      let built;
      try {
        built = scope(() => {
          try { return entry.factory(props); }
          catch (error) { failed = true; failure = error; }
        });
      } finally {
        routeSlots = outer;
      }
      if (failed) {
        try { built.dispose(); } catch (error) { console.error(error); }
        throw failure;
      }
      const node = built.result;
      const lifecycle = node.__lifecycle ??= { mounts: [], cleanups: [] };
      lifecycle.cleanups.push(built.dispose);
      node.__otfwHotFactory = entry.view;
      node.__otfwHotSlots = { shape: entry.shape, slots };
      return node;
    };
    return entry;
  });
  const updated = record.factory !== factory || record.shape !== shape;
  record.factory = factory;
  record.shape = shape;
  hot.accept();
  if (updated) queueMicrotask(() => {
    if (!hot.data.otfwInvalidated) void refreshHotRoute(record.view);
  });
  return record.view;
}

export function hotState(host, key, create) {
  const slots = host._hotState ??= new Map();
  if (!slots.has(key)) slots.set(key, create());
  return slots.get(key);
}

function cleanup(host) {
  const disposers = host._cleanups || [];
  host._cleanups = [];
  for (const dispose of disposers) {
    try { dispose(); } catch (error) { console.error(error); }
  }
}

function refresh(record, hosts) {
  for (const host of hosts) {
    if (!host.isConnected) continue;
    const scroll = [window.scrollX, window.scrollY];
    const focused = document.activeElement;
    const focusId = host.contains(focused) ? focused.id : null;
    const selection = focusId && typeof focused.selectionStart === "number"
      ? [focused.selectionStart, focused.selectionEnd] : null;
    cleanup(host);
    host._mounted = false;
    host._hotRefreshing = true;
    // Slotted children belong to the parent. Keep the original capture and move
    // those nodes into the new view in the same task (no genuine disconnect).
    host.replaceChildren(...(host._hotChildren || []));
    try { record.connected?.call(host); }
    finally { host._hotRefreshing = false; }
    if (focusId) {
      const target = document.getElementById(focusId);
      if (target && host.contains(target)) {
        target.focus({ preventScroll: true });
        if (selection && typeof target.setSelectionRange === "function") {
          try { target.setSelectionRange(...selection); } catch {}
        }
      }
    }
    window.scrollTo(...scroll);
  }
}

export function registerHotModule(hot, entries, safe, accept = true) {
  const signature = entries.map(([component, shape]) => [component.tag, shape]);
  const previous = hot?.data.otfwSignature;
  if (previous && (!safe || JSON.stringify(previous) !== JSON.stringify(signature))) {
    hot.data.otfwInvalidated = true;
    hot.invalidate();
    return;
  }
  if (hot) {
    hot.data.otfwSignature = signature;
    hot.data.otfwInvalidated = false;
  }
  const changed = [];
  for (const [component] of entries) {
    const tag = component.tag;
    let record = components.get(tag);
    const prototype = component.prototype;
    const connected = prototype.connectedCallback;
    const disconnected = prototype.disconnectedCallback;
    const attributeChanged = prototype.attributeChangedCallback;
    if (record) {
      Object.assign(record, { connected, disconnected, attributeChanged });
      changed.push(record);
      continue;
    }
    // A tag registered outside this refresh runtime cannot safely be replaced.
    if (customElements.get(tag)) {
      if (hot) hot.data.otfwInvalidated = true;
      hot?.invalidate();
      continue;
    }
    record = { connected, disconnected, attributeChanged, instances: new Set() };
    components.set(tag, record);
    prototype.connectedCallback = function () {
      record.instances.add(this);
      return record.connected?.call(this);
    };
    prototype.disconnectedCallback = function () {
      record.instances.delete(this);
      return record.disconnected?.call(this);
    };
    if (attributeChanged) prototype.attributeChangedCallback = function (...args) {
      return record.attributeChanged.call(this, ...args);
    };
    customElements.define(tag, component);
  }
  // Install all implementations first. Refresh existing ancestors before their
  // descendants, so children recreated by a parent don't mount twice per update.
  const jobs = changed.flatMap(record => [...record.instances].map(host => {
    let depth = 0;
    for (let parent = host.parentElement; parent; parent = parent.parentElement) depth++;
    return { record, host, depth };
  }));
  jobs.sort((a, b) => a.depth - b.depth);
  for (const { record, host } of jobs) refresh(record, [host]);
  if (safe && accept) hot?.accept();
}
