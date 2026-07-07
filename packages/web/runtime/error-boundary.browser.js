import { describe, expect, test } from "../../web-test/browser-runner.js";

import { ErrorBoundary, handleError } from "./error-boundary.js";

const tick = () => new Promise((r) => queueMicrotask(r));

// A component that throws on connect until a module flag is cleared — mirrors how
// a compiled component funnels its connectedCallback error through handleError.
let armed = true;
customElements.define(
  "web-bomb",
  class extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      try {
        if (armed) throw new Error("boom");
        this.appendChild(document.createTextNode("ok"));
      } catch (e) {
        handleError(this, e, { phase: "render", component: "Bomb" });
      }
    }
  },
);

describe("ErrorBoundary", () => {
  test("catches a descendant render error and shows the fallback", async () => {
    armed = true;
    const boundary = document.createElement("web-internal-error-boundary");
    boundary.fallback = (error) => `caught: ${error.message}`;
    boundary.appendChild(document.createElement("web-bomb"));
    document.body.appendChild(boundary); // connect: boundary, then bomb throws

    await tick(); // catch defers the swap to a microtask
    expect(boundary.querySelector("web-bomb")).toBe(null); // broken subtree torn down
    expect(boundary.textContent).toContain("caught: boom");
    boundary.remove();
  });

  test("reset() rebuilds the subtree and recovers once the cause is gone", async () => {
    armed = true;
    const boundary = document.createElement("web-internal-error-boundary");
    boundary.appendChild(document.createElement("web-bomb"));
    document.body.appendChild(boundary);
    await tick();
    expect(boundary.querySelector("[data-otfw-fallback]")).not.toBe(null);

    armed = false; // defuse, then retry
    boundary.reset();
    await tick();
    expect(boundary.querySelector("[data-otfw-fallback]")).toBe(null);
    expect(boundary.textContent).toContain("ok");
    boundary.remove();
  });

  test("ErrorBoundary export is the element class", () => {
    expect(ErrorBoundary).toBe(customElements.get("web-internal-error-boundary"));
  });
});
