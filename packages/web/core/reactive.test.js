import { describe, expect, test } from "bun:test";

import { effect, computed } from "./signals.js";
import { reactive, isReactive, toRawValue, snapshot } from "./reactive.js";

describe("reactive — reads & writes", () => {
  test("reads initial values, including nested", () => {
    const s = reactive({ a: 1, user: { name: "Alice" } });
    expect(s.a).toBe(1);
    expect(s.user.name).toBe("Alice");
  });

  test("writes update reads", () => {
    const s = reactive({ a: 1 });
    s.a = 2;
    expect(s.a).toBe(2);
  });

  test("nested writes work and persist", () => {
    const s = reactive({ user: { name: "Alice" } });
    s.user.name = "Bob";
    expect(s.user.name).toBe("Bob");
  });

  test("replacing a whole branch re-wraps on read", () => {
    const s = reactive({ user: { name: "Alice" } });
    s.user = { name: "Bob", age: 30 };
    expect(s.user.name).toBe("Bob");
    expect(s.user.age).toBe(30);
  });
});

describe("reactive — fine-grained subscription", () => {
  test("effect re-runs only when the read leaf changes", () => {
    const s = reactive({ a: 1, b: 1 });
    const seen = [];
    effect(() => seen.push(s.a));
    s.b = 99; // unrelated
    s.a = 2;
    expect(seen).toEqual([1, 2]);
  });

  test("sibling fields are independent", () => {
    const s = reactive({ user: { first: "A", last: "B" } });
    let firstRuns = 0;
    let lastRuns = 0;
    effect(() => { s.user.first; firstRuns++; });
    effect(() => { s.user.last; lastRuns++; });
    s.user.first = "Z";
    expect(firstRuns).toBe(2);
    expect(lastRuns).toBe(1); // not disturbed
  });

  test("unchanged write does not re-run (Object.is)", () => {
    const s = reactive({ a: 1 });
    let runs = 0;
    effect(() => { s.a; runs++; });
    s.a = 1;
    expect(runs).toBe(1);
  });

  test("computed derives from a store", () => {
    const s = reactive({ price: 10, qty: 2 });
    const total = computed(() => s.price * s.qty);
    expect(total.value).toBe(20);
    s.qty = 3;
    expect(total.value).toBe(30);
  });
});

describe("reactive — arrays", () => {
  test("index reads and writes", () => {
    const s = reactive({ items: ["a", "b"] });
    expect(s.items[0]).toBe("a");
    s.items[1] = "B";
    expect(s.items[1]).toBe("B");
  });

  test("push is reactive via length/structure", () => {
    const s = reactive({ items: ["a"] });
    const seen = [];
    effect(() => seen.push(s.items.length));
    s.items.push("b");
    expect(s.items.length).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  test("map subscribes to structure and elements", () => {
    const s = reactive({ items: [{ n: 1 }, { n: 2 }] });
    const seen = [];
    effect(() => seen.push(s.items.map((x) => x.n).join(",")));
    s.items.push({ n: 3 });
    expect(seen[seen.length - 1]).toBe("1,2,3");
  });

  test("splice mutates and notifies once", () => {
    const s = reactive({ items: ["a", "b", "c"] });
    let runs = 0;
    effect(() => { s.items.length; runs++; });
    s.items.splice(1, 1); // remove "b"
    expect(toRawValue(s).items).toEqual(["a", "c"]);
    expect(runs).toBe(2); // batched: a single re-run despite multiple internal writes
  });
});

describe("reactive — keys & shape", () => {
  test("ownKeys / spread reflect additions", () => {
    const s = reactive({ a: 1 });
    s.b = 2;
    expect(Object.keys(s).sort()).toEqual(["a", "b"]);
    expect({ ...s }).toEqual({ a: 1, b: 2 });
  });

  test("delete removes the key reactively", () => {
    const s = reactive({ a: 1, b: 2 });
    let seenHas;
    effect(() => { seenHas = "b" in s; });
    expect(seenHas).toBe(true);
    delete s.b;
    expect(seenHas).toBe(false);
    expect("b" in s).toBe(false);
  });
});

describe("reactive — helpers", () => {
  test("isReactive distinguishes stores", () => {
    const s = reactive({ a: 1 });
    expect(isReactive(s)).toBe(true);
    expect(isReactive({ a: 1 })).toBe(false);
    expect(isReactive(s.a)).toBe(false);
  });

  test("snapshot is a detached plain copy", () => {
    const s = reactive({ user: { name: "Alice" }, tags: ["x"] });
    const snap = snapshot(s);
    expect(snap).toEqual({ user: { name: "Alice" }, tags: ["x"] });
    expect(isReactive(snap)).toBe(false);
    s.user.name = "Bob";
    expect(snap.user.name).toBe("Alice"); // detached
  });

  test("snapshot does not subscribe the caller", () => {
    const s = reactive({ a: 1 });
    let runs = 0;
    effect(() => { snapshot(s); runs++; });
    s.a = 2;
    expect(runs).toBe(1);
  });

  test("setting a reactive value stores its raw form", () => {
    const a = reactive({ list: [1, 2] });
    const b = reactive({});
    b.copy = a.list;
    expect(isReactive(toRawValue(b).copy)).toBe(false);
    expect(b.copy[0]).toBe(1);
  });

  test("rejects non-wrappable input", () => {
    expect(() => reactive(5)).toThrow();
    expect(() => reactive(null)).toThrow();
  });
});
