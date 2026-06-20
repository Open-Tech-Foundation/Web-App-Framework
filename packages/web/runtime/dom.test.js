import { describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import { bindAttr, bindText, mount, setAttr, toText } from "./index.js";

describe("toText", () => {
  test("renders nullish and false as empty string", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
    expect(toText(false)).toBe("");
    expect(toText(0)).toBe("0");
    expect(toText("hi")).toBe("hi");
  });
});

describe("setAttr", () => {
  test("sets style objects, properties, attributes, and removes nullish", () => {
    const el = document.createElement("div");

    setAttr(el, "style", { color: "red" });
    expect(el.style.color).toBe("red");

    setAttr(el, "id", "x"); // plain attribute
    expect(el.getAttribute("id")).toBe("x");

    const input = document.createElement("input");
    setAttr(input, "value", "hello"); // property-backed
    expect(input.value).toBe("hello");

    setAttr(el, "title", null); // removed
    expect(el.hasAttribute("title")).toBe(false);

    setAttr(el, "hidden", true); // boolean attribute present
    expect(el.getAttribute("hidden")).toBe("");
  });

  test("wires on* handlers as properties", () => {
    const el = document.createElement("button");
    let clicks = 0;
    setAttr(el, "onClick", () => clicks++);
    el.click();
    expect(clicks).toBe(1);
  });
});

describe("bindText", () => {
  test("updates a text node reactively", () => {
    const name = signal("a");
    const node = document.createTextNode("");
    bindText(node, () => name.value);
    expect(node.data).toBe("a");
    name.value = "b";
    expect(node.data).toBe("b");
  });

  test("dispose stops updates", () => {
    const n = signal(1);
    const node = document.createTextNode("");
    const dispose = bindText(node, () => n.value);
    dispose();
    n.value = 2;
    expect(node.data).toBe("1");
  });
});

describe("bindAttr", () => {
  test("updates an attribute reactively", () => {
    const cls = signal("on");
    const el = document.createElement("div");
    bindAttr(el, "class", () => cls.value);
    expect(el.getAttribute("class")).toBe("on");
    cls.value = "off";
    expect(el.getAttribute("class")).toBe("off");
  });
});

describe("mount", () => {
  test("mounts a factory and a node", () => {
    const root = document.createElement("div");
    mount(() => {
      const el = document.createElement("span");
      el.textContent = "hi";
      return el;
    }, root);
    expect(root.innerHTML).toBe("<span>hi</span>");
  });
});
