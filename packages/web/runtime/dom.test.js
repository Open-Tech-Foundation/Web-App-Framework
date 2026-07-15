import { describe, expect, test } from "bun:test";

import { resetWarnings } from "../core/dev.js";
import { signal } from "../core/signals.js";
import { bindList } from "./dom.js";

function render(items, keyFn) {
  const parent = document.createElement("div");
  bindList(
    parent,
    () => items.value,
    (sig) => {
      const el = document.createElement("section");
      el.dataset.bornAs = sig.value.id ?? String(sig.value);
      return el;
    },
    keyFn,
  );
  return parent;
}

function captureWarnings(fn) {
  resetWarnings();
  const original = console.warn;
  const out = [];
  console.warn = (m) => out.push(m);
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return out;
}

// The index-key fallback (SPEC §5.4.4) silently re-points surviving nodes at
// their neighbour's data on a splice/reorder, so per-node state follows the wrong
// item. It stays the spec'd default; these cover the dev warning that fires at the
// exact reconcile where it goes wrong, and stays quiet when it cannot.
describe("bindList — keyless index-fallback warning", () => {
  test("warns when a keyless list reorders", () => {
    const items = signal([{ id: "W0" }, { id: "W1" }, { id: "W2" }]);
    const warnings = captureWarnings(() => {
      render(items, undefined);
      items.value = [items.value[0], items.value[2]]; // close middle W1
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("moved from index 2 to 1");
    console.log(warnings[0]);
  });

  test("warns only once, however many reorders follow", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const items = signal([a, b, c]);
    const warnings = captureWarnings(() => {
      render(items, undefined);
      items.value = [a, c];
      items.value = [c, a];
      items.value = [c];
    });
    expect(warnings.length).toBe(1);
  });

  test("silent when a key is supplied", () => {
    const items = signal([{ id: "W0" }, { id: "W1" }, { id: "W2" }]);
    const warnings = captureWarnings(() => {
      render(items, (i) => i.id);
      items.value = [items.value[0], items.value[2]];
    });
    expect(warnings).toEqual([]);
  });

  test("silent for append-only keyless lists (indices stay put)", () => {
    const a = { id: "a" }, b = { id: "b" };
    const items = signal([a]);
    const warnings = captureWarnings(() => {
      render(items, undefined);
      items.value = [a, b];
    });
    expect(warnings).toEqual([]);
  });

  test("silent for keyless primitive lists", () => {
    const items = signal(["a", "b", "c"]);
    const warnings = captureWarnings(() => {
      const parent = document.createElement("div");
      bindList(parent, () => items.value, () => document.createElement("li"), undefined);
      items.value = ["c", "a"];
    });
    expect(warnings).toEqual([]);
  });

  test("keyed lists destroy the right node", () => {
    const items = signal([{ id: "W0" }, { id: "W1" }, { id: "W2" }]);
    const parent = render(items, (i) => i.id);
    items.value = [items.value[0], items.value[2]];
    const after = [...parent.querySelectorAll("section")];
    expect(after.map((n) => n.dataset.bornAs)).toEqual(["W0", "W2"]);
  });
});
