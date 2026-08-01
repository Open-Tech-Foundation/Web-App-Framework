import { describe, expect, test } from "../../web-test/browser-runner.js";

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

  // Regression (hydration): on a server-rendered page the consumer's definition is
  // registered — and every matching element in the document upgrades — *before* the
  // enclosing component's hydrate code runs and assigns the provider's `context`
  // prop. `readContext` resolves providers with `closest()`, so unless the server
  // already wrote `data-otfw-ctx` into the markup, the consumer finds nothing and
  // binds to the context default forever. The SSG renderer emits that attribute
  // (server/builtins.js `hostAttrs`); this proves it is what rescues the ordering.
  test("a consumer upgrading before the provider's props are set still binds to it", () => {
    const Theme = createContext("default-theme");
    const captured = {};

    // Server markup: the provider carries its token, but no script has run, so its
    // `context`/`value` properties are still unset.
    const host = document.createElement("div");
    host.innerHTML =
      `<web-internal-context-provider data-otfw-ctx="${Theme.id}">` +
      `<web-ctx-late></web-ctx-late>` +
      `</web-internal-context-provider>`;
    document.body.appendChild(host);
    const p = host.firstElementChild;

    // The consumer upgrades here — before the provider is given its value below.
    customElements.define(
      "web-ctx-late",
      class extends HTMLElement {
        connectedCallback() {
          enterHost(this);
          try {
            captured.theme = readContext(Theme);
            effect(() => (this.textContent = String(captured.theme.value)));
          } finally {
            exitHost();
          }
        }
      },
    );
    customElements.upgrade(host);

    // It must have resolved the *provider's* signal, not the context default — so the
    // value the hydrate pass assigns a moment later reaches it.
    p.context = Theme;
    p.value = "light";
    expect(captured.theme.value).toBe("light");
    expect(host.querySelector("web-ctx-late").textContent).toBe("light");

    p.value = "solar"; // and it stays reactive
    expect(host.querySelector("web-ctx-late").textContent).toBe("solar");
    host.remove();
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
