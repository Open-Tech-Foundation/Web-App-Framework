// Mobile sidebar drawer — the DOM contract shared by <Sidebar> (the drawer) and
// <SidebarToggle> (the navbar burger). happy-dom evaluates no CSS, so the *visual*
// off-canvas/responsive behavior is covered by the browser e2e
// (tests/e2e/mobile-drawer.mjs); here we assert the JS-observable wiring: open/close
// state, the `is-open` classes, the body-scroll lock, the root flags, the
// cross-component event bridge, and teardown.
//
// The components are otfwc-compiled on import (the web-test preload), so we mount them
// the way the runtime does — by their registered custom-element tag — rather than
// through a JSX harness (which would itself be compiled into a component).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { router, setRouteState } from "@opentf/web";

import Sidebar from "../components/Sidebar.jsx";
import SidebarToggle from "../components/SidebarToggle.jsx";

const NAV = [
  { title: "Introduction", path: "/docs" },
  { title: "Guide", items: [{ title: "Routing", path: "/docs/routing" }] },
];

const tick = () => new Promise((r) => setTimeout(r, 0));
const root = () => document.documentElement;
const aside = () => document.querySelector("#otfw-sidebar");
const backdrop = () => document.querySelector(".otfw-sidebar-backdrop");
const burger = () => document.querySelector(".otfw-navbar-burger");

// Mount the burger + drawer as siblings, exactly how DocsLayout composes them (the
// burger in the navbar, the drawer in the content grid).
const mounted = new Set();
function mount() {
  const container = document.createElement("div");
  const toggle = document.createElement(SidebarToggle.tag);
  const drawer = document.createElement(Sidebar.tag);
  drawer.nav = NAV; // object prop → set before connect so it is read at mount
  container.append(toggle, drawer);
  document.body.appendChild(container);
  mounted.add(container);
  return { container, unmount: () => (container.remove(), mounted.delete(container)) };
}

beforeEach(() => {
  setRouteState({ pathname: "/docs" });
});

afterEach(() => {
  // Remove any still-mounted trees so each test sees exactly one drawer/burger (the
  // globals and the root flags are per-mount; disconnect runs their cleanup).
  for (const c of mounted) c.remove();
  mounted.clear();
  root().removeAttribute("data-otfw-has-sidebar");
  root().removeAttribute("data-otfw-sidebar-open");
  document.body.style.removeProperty("overflow");
  delete window.__otfwToggleSidebar;
  delete window.__otfwCloseSidebar;
});

describe("mobile sidebar drawer", () => {
  test("mounts the drawer closed and registers the toggle controls", async () => {
    mount();
    await tick();

    expect(aside()).not.toBeNull();
    expect(backdrop()).not.toBeNull();
    expect(burger()).not.toBeNull();

    // The burger shows only where a sidebar is mounted — flagged on the root.
    expect(root().hasAttribute("data-otfw-has-sidebar")).toBe(true);
    expect(typeof window.__otfwToggleSidebar).toBe("function");

    // Closed initial state.
    expect(aside().classList.contains("is-open")).toBe(false);
    expect(backdrop().classList.contains("is-open")).toBe(false);
    expect(burger().getAttribute("aria-expanded")).toBe("false");
    expect(burger().getAttribute("aria-controls")).toBe("otfw-sidebar");
  });

  test("the drawer renders its nav tree from the `nav` prop", async () => {
    mount();
    await tick();

    const links = aside().querySelectorAll(".otfw-sidebar-link");
    const labels = Array.from(links, (a) => a.textContent.trim());
    expect(labels).toContain("Introduction");
    expect(labels).toContain("Routing");
  });

  test("burger opens the drawer, locks scroll, and syncs aria-expanded", async () => {
    mount();
    await tick();

    burger().click();
    await tick();

    expect(aside().classList.contains("is-open")).toBe(true);
    expect(backdrop().classList.contains("is-open")).toBe(true);
    expect(root().hasAttribute("data-otfw-sidebar-open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    // aria-expanded is mirrored across components via the otfw:sidebar event.
    expect(burger().getAttribute("aria-expanded")).toBe("true");
  });

  test("burger toggles closed again and releases the scroll lock", async () => {
    mount();
    await tick();

    burger().click();
    await tick();
    burger().click();
    await tick();

    expect(aside().classList.contains("is-open")).toBe(false);
    expect(root().hasAttribute("data-otfw-sidebar-open")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(burger().getAttribute("aria-expanded")).toBe("false");
  });

  test("clicking the backdrop closes the drawer", async () => {
    mount();
    await tick();

    burger().click();
    await tick();
    backdrop().click();
    await tick();

    expect(aside().classList.contains("is-open")).toBe(false);
    expect(burger().getAttribute("aria-expanded")).toBe("false");
  });

  test("Escape closes the drawer", async () => {
    mount();
    await tick();

    burger().click();
    await tick();
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    await tick();

    expect(aside().classList.contains("is-open")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  test("navigating closes the drawer", async () => {
    mount();
    await tick();

    burger().click();
    await tick();
    expect(aside().classList.contains("is-open")).toBe(true);

    // Simulate an SPA navigation (e.g. tapping a link in the drawer).
    setRouteState({ pathname: "/docs/routing" });
    await tick();

    expect(router.pathname).toBe("/docs/routing");
    expect(aside().classList.contains("is-open")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  test("unmounting clears the root flag, global, and scroll lock", async () => {
    const { unmount } = mount();
    await tick();

    burger().click();
    await tick();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    await tick();

    expect(root().hasAttribute("data-otfw-has-sidebar")).toBe(false);
    expect(window.__otfwToggleSidebar).toBeUndefined();
    expect(document.body.style.overflow).toBe("");
  });
});
