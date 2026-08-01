import { describe, expect, test } from "../../web-test/browser-runner.js";

import { ErrorBoundary, handleError } from "./error-boundary.js";
import { hydrationProps } from "./hydrate.js";

const tick = () => new Promise((r) => queueMicrotask(r));

// A component that throws on connect until a module flag is cleared — mirrors how
// a compiled component funnels its connectedCallback error through handleError,
// including the deferred disconnect teardown that resets `_mounted` so a
// re-inserted element renders again.
let armed = true;
customElements.define(
  "web-bomb",
  class extends HTMLElement {
    connectedCallback() {
      this._pendingTeardown = false;
      if (this._mounted) return;
      this._mounted = true;
      try {
        if (armed) throw new Error("boom");
        this.appendChild(document.createTextNode("ok"));
      } catch (e) {
        handleError(this, e, { phase: "render", component: "Bomb" });
      }
    }
    disconnectedCallback() {
      this._pendingTeardown = true;
      queueMicrotask(() => {
        if (!this._pendingTeardown) return;
        this._pendingTeardown = false;
        this._mounted = false;
        this.replaceChildren();
      });
    }
  },
);

// A component whose throw condition comes from a *prop*, initialized the way the
// compiler emits it on an SSR/SSG page: read the server-recorded props out of the
// hydration record at construct time, then let the parent push updates in through
// the property setter. This is the shape that made Retry unrecoverable — see the
// "props updated after the failure" test.
customElements.define(
  "web-prop-bomb",
  class extends HTMLElement {
    constructor() {
      super();
      const props = hydrationProps(this);
      this._armed = props && "armed" in props ? props.armed : this.hasAttribute("armed");
    }
    get armed() {
      return this._armed;
    }
    set armed(v) {
      this._armed = v;
    }
    connectedCallback() {
      this._pendingTeardown = false;
      if (this._mounted) return;
      this._mounted = true;
      try {
        if (this._armed) throw new Error("prop boom");
        this.appendChild(document.createTextNode("ok"));
      } catch (e) {
        handleError(this, e, { phase: "render", component: "PropBomb" });
      }
    }
    disconnectedCallback() {
      this._pendingTeardown = true;
      queueMicrotask(() => {
        if (!this._pendingTeardown) return;
        this._pendingTeardown = false;
        this._mounted = false;
        this.replaceChildren();
      });
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

  // Regression: reset() used to replay `cloneNode(true)` snapshots. A clone is a
  // different element from the one the parent's reactive prop bindings target, so
  // the fix the user just made never reached the rebuilt subtree and Retry threw
  // forever. On an SSR page the clone also carried `data-h`, which made the rebuilt
  // component re-read its *frozen server-time* props out of the hydration payload.
  test("reset() delivers props updated after the failure", async () => {
    const boundary = document.createElement("web-internal-error-boundary");
    // `data-hp` is how a pre-route-render island carries its server props; it goes
    // through the same reader as the `data-h` payload the SSG writes.
    boundary.innerHTML = `<web-prop-bomb data-hp='{"armed":true}'></web-prop-bomb>`;
    const bomb = boundary.firstElementChild;
    document.body.appendChild(boundary);
    await tick();
    expect(boundary.querySelector("[data-otfw-fallback]")).not.toBe(null);

    // The parent pushes the fix in through the same element it has always held —
    // exactly what a compiled `armed={value}` binding does.
    bomb.armed = false;
    boundary.reset();
    await tick();
    await tick();
    expect(boundary.querySelector("[data-otfw-fallback]")).toBe(null);
    expect(boundary.textContent).toContain("ok");
    boundary.remove();
  });

  test("ErrorBoundary export is the element class", () => {
    expect(ErrorBoundary).toBe(customElements.get("web-internal-error-boundary"));
  });
});
