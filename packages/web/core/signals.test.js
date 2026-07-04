import { describe, expect, test } from "bun:test";

import { batch, computed, effect, scope, signal } from "./signals.js";

describe("signal", () => {
  test("reads and writes a value", () => {
    const count = signal(1);
    expect(count.value).toBe(1);
    count.value = 2;
    expect(count.value).toBe(2);
  });
});

describe("effect", () => {
  test("runs immediately and re-runs on dependency change", () => {
    const count = signal(0);
    const seen = [];
    effect(() => seen.push(count.value));
    count.value = 1;
    count.value = 2;
    expect(seen).toEqual([0, 1, 2]);
  });

  test("does not re-run when the value is unchanged (Object.is)", () => {
    const count = signal(0);
    let runs = 0;
    effect(() => {
      count.value;
      runs++;
    });
    count.value = 0;
    expect(runs).toBe(1);
  });

  test("tracks dependencies dynamically", () => {
    const toggle = signal(true);
    const a = signal("a");
    const b = signal("b");
    const seen = [];
    effect(() => seen.push(toggle.value ? a.value : b.value));

    // Currently depends on `a`, not `b`.
    b.value = "b2";
    expect(seen).toEqual(["a"]);

    toggle.value = false; // now reads b
    a.value = "a2"; // no longer a dependency
    expect(seen).toEqual(["a", "b2"]);
  });

  test("dispose stops further runs and calls cleanup", () => {
    const count = signal(0);
    const seen = [];
    let cleaned = 0;
    const dispose = effect(() => {
      seen.push(count.value);
      return () => cleaned++;
    });
    count.value = 1;
    dispose();
    count.value = 2;
    expect(seen).toEqual([0, 1]);
    // cleanup ran before the re-run at value=1, then again on dispose.
    expect(cleaned).toBe(2);
  });

  test("cleanup runs before each re-run", () => {
    const count = signal(0);
    const order = [];
    effect(() => {
      const v = count.value;
      order.push(`run:${v}`);
      return () => order.push(`cleanup:${v}`);
    });
    count.value = 1;
    expect(order).toEqual(["run:0", "cleanup:0", "run:1"]);
  });
});

describe("computed", () => {
  test("derives and caches until a dependency changes", () => {
    const n = signal(2);
    let calls = 0;
    const double = computed(() => {
      calls++;
      return n.value * 2;
    });

    expect(calls).toBe(0); // lazy: not computed until read
    expect(double.value).toBe(4);
    expect(double.value).toBe(4);
    expect(calls).toBe(1); // cached

    n.value = 3;
    expect(calls).toBe(1); // still lazy: no subscriber forced recompute
    expect(double.value).toBe(6);
    expect(calls).toBe(2);
  });

  test("effect re-runs when a computed dependency changes", () => {
    const n = signal(1);
    const double = computed(() => n.value * 2);
    const seen = [];
    effect(() => seen.push(double.value));
    n.value = 5;
    expect(seen).toEqual([2, 10]);
  });

  test("diamond dependency runs the effect once per change (glitch-free)", () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 2);
    let runs = 0;
    effect(() => {
      b.value;
      c.value;
      runs++;
    });
    expect(runs).toBe(1);
    a.value = 10;
    expect(runs).toBe(2); // not 3
  });
});

describe("batch", () => {
  test("coalesces multiple writes into a single effect run", () => {
    const a = signal(1);
    const b = signal(2);
    let runs = 0;
    let sum = 0;
    effect(() => {
      sum = a.value + b.value;
      runs++;
    });
    batch(() => {
      a.value = 10;
      b.value = 20;
    });
    expect(sum).toBe(30);
    expect(runs).toBe(2); // initial + one batched run
  });
});

describe("scope", () => {
  test("dispose stops every effect created inside", () => {
    const s = signal(0);
    let runsA = 0;
    let runsB = 0;
    const sc = scope(() => {
      effect(() => { runsA++; s.value; });
      effect(() => { runsB++; s.value; });
      return "result";
    });
    expect(sc.result).toBe("result");

    s.value = 1;
    expect(runsA).toBe(2);
    expect(runsB).toBe(2);

    sc.dispose();
    s.value = 2;
    expect(runsA).toBe(2); // no re-run after dispose
    expect(runsB).toBe(2);
  });

  test("an inner scope claims its effects away from the outer one", () => {
    const s = signal(0);
    let outerRuns = 0;
    let innerRuns = 0;
    let inner;
    const outer = scope(() => {
      effect(() => { outerRuns++; s.value; });
      inner = scope(() => {
        effect(() => { innerRuns++; s.value; });
      });
    });

    outer.dispose(); // must not touch the inner scope's effect
    s.value = 1;
    expect(outerRuns).toBe(1);
    expect(innerRuns).toBe(2);

    inner.dispose();
    s.value = 2;
    expect(innerRuns).toBe(2);
  });

  test("effects created during a flush re-run don't join an ambient scope", () => {
    // A region effect creating children on re-run manages them itself; the
    // scope that happened to be open when the *write* occurred must not adopt
    // them (it would dispose another region's live bindings).
    const trigger = signal(0);
    const s = signal(0);
    let childRuns = 0;
    effect(() => {
      if (trigger.value > 0) {
        effect(() => { childRuns++; s.value; });
      }
    });

    const ambient = scope(() => {
      trigger.value = 1; // re-runs the outer effect, which creates the child
    });
    ambient.dispose();

    s.value = 1; // child must still be alive — ambient never owned it
    expect(childRuns).toBe(2);
  });
});
