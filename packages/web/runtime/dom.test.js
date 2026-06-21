import { describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import { bindAttr, bindChild, bindList, bindText, mount, setAttr, setProp, spread, toText } from "./index.js";

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

    // Numbers get px appended; unitless properties don't; custom props go through.
    setAttr(el, "style", { width: 8, opacity: 0.5, "--gap": 4 });
    expect(el.style.width).toBe("8px");
    expect(el.style.opacity).toBe("0.5");
    expect(el.style.getPropertyValue("--gap")).toBe("4");

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

  test("writes enumerated and ARIA attributes as 'true'/'false' keywords", () => {
    const el = document.createElement("div");

    setAttr(el, "draggable", true); // enumerated: needs the literal keyword
    expect(el.getAttribute("draggable")).toBe("true");

    setAttr(el, "draggable", false); // not removed — keyword "false"
    expect(el.getAttribute("draggable")).toBe("false");

    setAttr(el, "aria-expanded", true);
    expect(el.getAttribute("aria-expanded")).toBe("true");

    setAttr(el, "aria-hidden", null); // nullish still removes
    expect(el.hasAttribute("aria-hidden")).toBe(false);
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

  test("inserts node-valued expressions (JSX stored as a value) and swaps them", () => {
    const parent = document.createElement("div");
    const anchor = document.createTextNode("");
    parent.appendChild(anchor);
    const a = document.createElement("i");
    const b = document.createElement("b");
    const which = signal(a);
    bindText(anchor, () => which.value);
    expect(parent.querySelector("i")).toBe(a);
    expect(parent.querySelector("b")).toBeNull();
    which.value = b;
    expect(parent.querySelector("i")).toBeNull();
    expect(parent.querySelector("b")).toBe(b);
    // Falling back to text removes the previously inserted node.
    which.value = "hi";
    expect(parent.querySelector("b")).toBeNull();
    expect(parent.textContent).toBe("hi");
  });
});

describe("setProp", () => {
  test("sets a property when the element exposes one, else an attribute", () => {
    // Custom element with a value property setter (like ContextProvider).
    let received;
    customElements.define(
      "x-setprop",
      class extends HTMLElement {
        set value(v) {
          received = v;
        }
      },
    );
    const ce = document.createElement("x-setprop");

    const obj = { a: 1 };
    setProp(ce, "value", obj); // property exists → setter receives the object
    expect(received).toBe(obj);

    setProp(ce, "class", "card"); // no such property → attribute
    expect(ce.getAttribute("class")).toBe("card");
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

describe("bindList", () => {
  const render = (sig) => {
    const li = document.createElement("li");
    bindText(li.appendChild(document.createTextNode("")), () => sig.value.name);
    return li;
  };
  const key = (item) => item.id;
  const text = (parent) =>
    Array.from(parent.querySelectorAll("li")).map((li) => li.textContent).join(",");

  test("renders, reorders (reusing nodes), updates, and removes by key", () => {
    const items = signal([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    const parent = document.createElement("ul");
    bindList(parent, () => items.value, render, key);
    expect(text(parent)).toBe("a,b");

    const firstA = parent.querySelector("li");

    // Insert in the middle.
    items.value = [{ id: 1, name: "a" }, { id: 3, name: "c" }, { id: 2, name: "b" }];
    expect(text(parent)).toBe("a,c,b");

    // Reorder + drop: the node for id:1 must be the *same* element (keyed reuse).
    items.value = [{ id: 2, name: "b" }, { id: 1, name: "a" }];
    expect(text(parent)).toBe("b,a");
    expect(parent.querySelectorAll("li")[1]).toBe(firstA);

    // Fine-grained update: same node, new text.
    items.value = [{ id: 2, name: "b" }, { id: 1, name: "A" }];
    expect(text(parent)).toBe("b,A");
    expect(parent.querySelectorAll("li")[1]).toBe(firstA);
  });

  test("falls back to index when no keyFn is given", () => {
    const items = signal(["x", "y"]);
    const parent = document.createElement("ul");
    bindList(parent, () => items.value, (sig) => {
      const li = document.createElement("li");
      bindText(li.appendChild(document.createTextNode("")), () => sig.value);
      return li;
    });
    expect(text(parent)).toBe("x,y");
    items.value = ["x", "y", "z"];
    expect(text(parent)).toBe("x,y,z");
  });
});

describe("spread", () => {
  test("applies attributes to elements and properties to components", () => {
    const el = document.createElement("div");
    spread(el, { id: "a", title: "t" }, false);
    expect(el.getAttribute("id")).toBe("a");
    expect(el.getAttribute("title")).toBe("t");

    const comp = document.createElement("div"); // stand-in for a custom element
    spread(comp, { foo: { nested: 1 }, bar: 2 }, true);
    expect(comp.foo).toEqual({ nested: 1 });
    expect(comp.bar).toBe(2);

    spread(el, null, false); // nullish is a no-op
  });
});

describe("bindChild", () => {
  test("swaps conditional elements, text, and nothing", () => {
    const which = signal(0);
    const parent = document.createElement("div");
    const anchor = parent.appendChild(document.createComment(""));
    bindChild(anchor, () => {
      if (which.value === 0) return null; // nothing
      if (which.value === 1) {
        const p = document.createElement("p");
        p.textContent = "one";
        return p;
      }
      return "text"; // primitive → text node
    });
    expect(parent.textContent).toBe("");
    expect(parent.querySelector("p")).toBeNull();

    which.value = 1;
    expect(parent.querySelector("p").textContent).toBe("one");

    which.value = 2;
    expect(parent.querySelector("p")).toBeNull();
    expect(parent.textContent).toBe("text");

    which.value = 0; // back to nothing
    expect(parent.textContent).toBe("");
  });

  test("renders arrays of nodes and keeps anchor position", () => {
    const items = signal(["a", "b"]);
    const parent = document.createElement("div");
    parent.appendChild(document.createTextNode("["));
    const anchor = parent.appendChild(document.createComment(""));
    parent.appendChild(document.createTextNode("]"));
    bindChild(anchor, () => items.value.map((t) => {
      const s = document.createElement("span");
      s.textContent = t;
      return s;
    }));
    expect(parent.textContent).toBe("[ab]");
    items.value = ["x"];
    expect(parent.textContent).toBe("[x]");
  });

  test("dispose stops updates", () => {
    const on = signal(true);
    const parent = document.createElement("div");
    const anchor = parent.appendChild(document.createComment(""));
    const dispose = bindChild(anchor, () => (on.value ? document.createElement("b") : null));
    expect(parent.querySelector("b")).not.toBeNull();
    dispose();
    on.value = false;
    expect(parent.querySelector("b")).not.toBeNull(); // frozen
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
