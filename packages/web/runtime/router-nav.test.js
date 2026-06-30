// Navigation mode (docs/HYDRATION.md §7): SPA (default) lets the client router
// intercept `<Link>` clicks; MPA leaves navigation to the browser (full page load).
// A per-link `reload` opts a single link out of SPA interception.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import Link from "../components/Link.jsx"; // defines <web-link> on import
import { mountApp, routes, shouldInterceptNav } from "./router.js";

beforeEach(() => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
});

afterEach(() => {
  document.body.innerHTML = "";
  mountApp({ nav: "spa" }); // reset module-level navMode for other files
});

// Build a <web-link href> in the DOM and dispatch a plain left-click on its <a>.
function clickLink(attrs = {}) {
  const el = document.createElement("web-link");
  el.setAttribute("href", "/about");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el); // connectedCallback builds the inner <a>
  const a = el.querySelector("a");
  const ev = new Event("click", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "button", { value: 0 }); // primary click (Link guards button !== 0)
  a.dispatchEvent(ev);
  return ev;
}

describe("nav mode", () => {
  test("defaults to SPA — the client router intercepts", () => {
    mountApp({});
    expect(shouldInterceptNav()).toBe(true);
  });

  test('nav: "mpa" disables interception', () => {
    mountApp({ nav: "mpa" });
    expect(shouldInterceptNav()).toBe(false);
  });
});

describe("<Link> interception", () => {
  test("SPA mode intercepts the click (preventDefault → client nav)", () => {
    mountApp({ nav: "spa" });
    expect(clickLink().defaultPrevented).toBe(true);
  });

  test("MPA mode lets the browser navigate (no preventDefault)", () => {
    mountApp({ nav: "mpa" });
    expect(clickLink().defaultPrevented).toBe(false);
  });

  test("reload forces a full navigation even in SPA mode", () => {
    mountApp({ nav: "spa" });
    expect(clickLink({ reload: "" }).defaultPrevented).toBe(false);
  });
});
