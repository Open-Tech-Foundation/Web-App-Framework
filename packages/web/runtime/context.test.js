import { describe, expect, test } from "bun:test";

import { effect } from "../core/signals.js";
import { createContext, enterHost, exitHost, readContext } from "./context.js";

// Build a <web-internal-context-provider> with a value, returning the element.
function provider(context, value) {
  const el = document.createElement("web-internal-context-provider");
  el.context = context; // sets the data-otfw-ctx marker
  el.value = value;
  return el;
}

describe("context", () => {
  test("returns the default (as a signal) when there is no provider", () => {
    const Theme = createContext("dark");
    const child = document.createElement("div");
    document.body.appendChild(child);
    enterHost(child);
    const t = readContext(Theme);
    exitHost();
    expect(t.value).toBe("dark");
    child.remove();
  });

  test("resolves the nearest provider via DOM ancestry and stays reactive", () => {
    const Theme = createContext("dark");
    const p = provider(Theme, "light");
    const child = document.createElement("button");
    p.appendChild(child);
    document.body.appendChild(p);

    enterHost(child);
    const t = readContext(Theme);
    exitHost();

    const seen = [];
    effect(() => seen.push(t.value));
    expect(seen).toEqual(["light"]);

    p.value = "solar"; // updating the provider value updates the consumer
    expect(seen).toEqual(["light", "solar"]);
    p.remove();
  });

  test("a nested provider overrides an outer one for its subtree", () => {
    const Theme = createContext("dark");
    const outer = provider(Theme, "outer");
    const inner = provider(Theme, "inner");
    const child = document.createElement("span");
    inner.appendChild(child);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    enterHost(child);
    const inProvided = readContext(Theme);
    exitHost();
    expect(inProvided.value).toBe("inner");

    // A consumer directly under the outer provider sees the outer value.
    const sibling = document.createElement("span");
    outer.appendChild(sibling);
    enterHost(sibling);
    const outProvided = readContext(Theme);
    exitHost();
    expect(outProvided.value).toBe("outer");
    outer.remove();
  });

  test("resolves at connect time the way the compiler emits it", () => {
    const Theme = createContext("dark");

    // Mirror a compiled context consumer: enterHost(this) → readContext → exitHost().
    let captured;
    customElements.define(
      "web-ctx-consumer",
      class extends HTMLElement {
        connectedCallback() {
          enterHost(this);
          try {
            captured = readContext(Theme);
            this.textContent = captured.value;
          } finally {
            exitHost();
          }
        }
      },
    );

    const p = provider(Theme, "light");
    const consumer = document.createElement("web-ctx-consumer");
    p.appendChild(consumer); // detached
    document.body.appendChild(p); // connect fires here, top-down

    expect(consumer.textContent).toBe("light");
    p.value = "solar";
    expect(captured.value).toBe("solar"); // still wired to the provider signal
    p.remove();
  });

  test("the host stack restores the parent host after a nested pop", () => {
    const A = document.createElement("div");
    const B = document.createElement("div");
    enterHost(A);
    enterHost(B); // nested connect
    exitHost(); // B done
    const Theme = createContext("x");
    // Now A is current again; with no provider it falls back, proving A is on top.
    const t = readContext(Theme);
    exitHost();
    expect(t.value).toBe("x");
  });
});
