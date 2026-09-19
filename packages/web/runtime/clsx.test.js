import { describe, expect, test } from "bun:test";

import { setAttr } from "./dom.js";

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
