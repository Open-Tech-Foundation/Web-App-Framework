import { describe, expect, test } from "bun:test";

import * as web from "../index.js";
import { onCleanup, onMediaQuery, onMount, onResize, onVisibilityChange } from "./lifecycle.js";

// The lifecycle hooks are compiler macros; these exports exist so the
// source-level import resolves and stray calls (SSR, outside a compiled
// component) are safe no-ops. Guards the SSR import path.
describe("lifecycle stubs", () => {
  const hooks = { onMount, onCleanup, onResize, onMediaQuery, onVisibilityChange };

  test("all hooks are exported from the package root", () => {
    for (const name of Object.keys(hooks)) {
      expect(typeof web[name]).toBe("function");
    }
  });

  test("calling a hook outside a compiled component is a no-op", () => {
    for (const hook of Object.values(hooks)) {
      expect(hook(() => {})).toBeUndefined();
    }
    expect(onMediaQuery("(min-width: 768px)", () => {})).toBeUndefined();
  });
});
