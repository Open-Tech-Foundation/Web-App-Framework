import { describe, expect, test } from "bun:test";

import { clearError, onError, reportError } from "./errors.js";
import { effect, signal } from "./signals.js";

describe("error bus", () => {
  test("notifies subscribers with the error and context, and disposes", () => {
    const seen = [];
    const off = onError((error, context) => seen.push([error, context]));

    const err = new Error("boom");
    reportError(err, { phase: "render" });
    expect(seen).toEqual([[err, { phase: "render" }]]);

    off();
    reportError(new Error("again"), { phase: "render" });
    expect(seen.length).toBe(1); // unsubscribed
  });

  test("dispatches an otfw:error window event", () => {
    let detail = null;
    const handler = (e) => (detail = e.detail);
    window.addEventListener("otfw:error", handler);
    const err = new Error("x");
    reportError(err, { phase: "effect" });
    window.removeEventListener("otfw:error", handler);
    expect(detail.error).toBe(err);
    expect(detail.context).toEqual({ phase: "effect" });
  });

  test("clearError dispatches otfw:error-clear", () => {
    let fired = false;
    const handler = () => (fired = true);
    window.addEventListener("otfw:error-clear", handler);
    clearError({ phase: "route" });
    window.removeEventListener("otfw:error-clear", handler);
    expect(fired).toBe(true);
  });

  test("a throwing effect is reported and the scheduler survives", () => {
    const reported = [];
    const off = onError((e, ctx) => reported.push(ctx.phase));

    const n = signal(0);
    let otherRuns = 0;

    effect(() => {
      if (n.value > 0) throw new Error("update failed");
    });
    effect(() => {
      n.value; // depends on n too
      otherRuns++;
    });

    expect(otherRuns).toBe(1); // initial run
    n.value = 1; // triggers both effects; the first throws

    off();
    expect(reported).toContain("effect"); // first effect's throw was reported
    expect(otherRuns).toBe(2); // second effect still ran despite the first throwing
  });
});
