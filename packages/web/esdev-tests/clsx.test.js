import { describe, expect, test } from "runtime:test";

import { clsx } from "../runtime/dom.js";

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
