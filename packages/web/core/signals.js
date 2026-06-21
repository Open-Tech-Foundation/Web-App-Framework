//! Fine-grained reactivity — our own signals core.
//
// This replaces the previous `@preact/signals-core` dependency to remove a
// third-party supply-chain risk (SPEC §1.1). The public surface is the
// industry-standard `signal` / `computed` / `effect` with a `.value` accessor;
// more APIs (peek/untracked/subscribe) are added only when a consumer needs them.
//
// Model: producers (signals, computeds) hold a set of subscribers; consumers
// (effects, computeds) track the producers they read. Reads register a
// dependency on the active consumer; writes mark dependent computeds stale and
// queue dependent effects, which run once per change/batch (glitch-free: an
// effect that depends on a signal both directly and via a computed runs once).

import { reportError } from "./errors.js";

/** The consumer (effect or computed) currently executing, if any. */
let activeConsumer = null;
/** Depth of nested `batch()` calls; effects flush when this returns to 0. */
let batchDepth = 0;
/** Re-entrancy guard for the flush loop. */
let flushing = false;
/** Effects queued to run on the next flush. A Set so each runs at most once. */
const pendingEffects = new Set();

/** Register `producer` as a dependency of the consumer currently running. */
function track(producer) {
  if (activeConsumer) {
    activeConsumer.sources.add(producer);
    producer.subscribers.add(activeConsumer);
  }
}

/** Detach a consumer from all producers it previously read. */
function clearSources(consumer) {
  for (const source of consumer.sources) {
    source.subscribers.delete(consumer);
  }
  consumer.sources.clear();
}

/** Mark dependents stale: computeds recursively, effects into the run queue. */
function propagate(producer) {
  for (const sub of producer.subscribers) {
    if (sub.kind === "computed") {
      if (!sub.stale) {
        sub.stale = true;
        propagate(sub);
      }
    } else {
      pendingEffects.add(sub);
    }
  }
}

/** Run all queued effects, including any they queue in turn. */
function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (pendingEffects.size > 0) {
      const batch = [...pendingEffects];
      pendingEffects.clear();
      for (const effectNode of batch) {
        if (effectNode.disposed) continue;
        // A throwing reactive update is reported but must not break the scheduler
        // (other queued effects still run). Build-time (initial) runs propagate so
        // the surrounding component/page catch can handle them.
        try {
          effectNode.run();
        } catch (e) {
          reportError(e, { phase: "effect" });
        }
      }
    }
  } finally {
    flushing = false;
  }
}

/**
 * A writable reactive value. Reading `.value` inside an effect/computed
 * subscribes to it; writing a changed `.value` notifies dependents.
 */
export function signal(initial) {
  const node = { kind: "signal", value: initial, subscribers: new Set() };
  return {
    get value() {
      track(node);
      return node.value;
    },
    set value(next) {
      if (Object.is(next, node.value)) return;
      node.value = next;
      propagate(node);
      if (batchDepth === 0) flush();
    },
  };
}

/**
 * A derived, read-only reactive value. Lazy and cached: the compute function
 * runs only when `.value` is read while stale, and recomputes only after a
 * dependency changes.
 */
export function computed(fn) {
  const node = {
    kind: "computed",
    fn,
    value: undefined,
    stale: true,
    sources: new Set(),
    subscribers: new Set(),
  };
  return {
    get value() {
      if (node.stale) {
        const prev = activeConsumer;
        clearSources(node);
        activeConsumer = node;
        try {
          node.value = node.fn();
          node.stale = false;
        } finally {
          activeConsumer = prev;
        }
      }
      track(node);
      return node.value;
    },
  };
}

/**
 * Run `fn` immediately, tracking the signals it reads, and re-run it whenever
 * any of them change. `fn` may return a cleanup function, which runs before the
 * next re-run and on dispose. Returns a disposer that stops the effect.
 */
export function effect(fn) {
  const node = {
    kind: "effect",
    fn,
    cleanup: undefined,
    sources: new Set(),
    disposed: false,
    run() {
      if (node.disposed) return;
      runCleanup(node);
      clearSources(node);
      const prev = activeConsumer;
      activeConsumer = node;
      try {
        const result = node.fn();
        if (typeof result === "function") node.cleanup = result;
      } finally {
        activeConsumer = prev;
      }
    },
  };
  node.run();
  return function dispose() {
    if (node.disposed) return;
    node.disposed = true;
    runCleanup(node);
    clearSources(node);
  };
}

function runCleanup(node) {
  if (node.cleanup) {
    const fn = node.cleanup;
    node.cleanup = undefined;
    fn();
  }
}

/**
 * Group multiple writes so dependent effects run once after the outermost batch
 * completes, instead of after each write.
 */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}
