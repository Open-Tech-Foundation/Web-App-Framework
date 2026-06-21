import { describe, expect, test } from "bun:test";

import { clsx, setAttr } from "./dom.js";

describe("clsx", () => {
  test("keeps truthy strings/numbers, skips falsy", () => {
    expect(clsx(["a", false, "b", null, undefined, "", "c"])).toBe("a b c");
    expect(clsx(5)).toBe("5");
    expect(clsx(0)).toBe("");
  });

  test("objects contribute keys with truthy values", () => {
    expect(clsx({ a: true, b: 0, c: 1, d: false })).toBe("a c");
  });

  test("recurses arrays and mixes forms", () => {
    expect(clsx(["btn", ["a", { b: true, c: false }], 2 > 1 && "on"])).toBe("btn a b on");
  });
});

describe("setAttr class normalization", () => {
  test("array/object class values are flattened to a string", () => {
    const el = document.createElement("div");
    setAttr(el, "class", ["btn", false, { active: true }]);
    expect(el.getAttribute("class")).toBe("btn active");
  });

  test("an empty result removes the attribute; plain strings pass through", () => {
    const el = document.createElement("div");
    setAttr(el, "class", "plain");
    expect(el.getAttribute("class")).toBe("plain");
    setAttr(el, "class", [false, null]);
    expect(el.hasAttribute("class")).toBe(false);
  });
});
