// The sidebar's "collapse all" icon button — <Sidebar> renders the button, but the
// open/closed state lives in each recursive <SidebarNode>, so the two talk through the
// shared `collapseAll` signal (components/sidebar-collapse.js). These tests assert that
// contract end to end on the mounted DOM: one press collapses every group, the icon
// button flips to "expand all", the branch holding the active route stays open, and the
// state survives a re-mount (SPA navigation).
//
// Rendering/visual details (the CSS) are out of scope here — happy-dom evaluates no CSS.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setRouteState } from "@opentf/web";

import Sidebar from "../components/Sidebar.jsx";
import { collapseAll } from "../components/sidebar-collapse.js";

const NAV = [
  { title: "Introduction", path: "/docs" },
  {
    title: "Guide",
    items: [
      { title: "Concepts", items: [{ title: "Deep", path: "/docs/guide/concepts/deep" }] },
      { title: "Routing", path: "/docs/guide/routing" },
    ],
  },
  { title: "Reference", items: [{ title: "API", path: "/docs/api" }] },
];

const tick = () => new Promise((r) => setTimeout(r, 0));
const aside = () => document.querySelector("#otfw-sidebar");
const button = () => document.querySelector(".otfw-sidebar-collapse-all");
const toggles = () => Array.from(document.querySelectorAll(".otfw-sidebar-group-toggle"));
const toggleFor = (label) => toggles().find((b) => b.textContent.trim() === label);
const expandedFlags = () => toggles().map((b) => b.getAttribute("aria-expanded"));

const mounted = new Set();
function mount(nav = NAV) {
  const container = document.createElement("div");
  const drawer = document.createElement(Sidebar.tag);
  drawer.nav = nav; // object props → set before connect so they're read at mount
  container.appendChild(drawer);
  document.body.appendChild(container);
  mounted.add(container);
  return { container, unmount: () => (container.remove(), mounted.delete(container)) };
}

beforeEach(() => {
  setRouteState({ pathname: "/docs" });
  collapseAll.reset(); // module-scope state outlives a single test
});

afterEach(() => {
  for (const c of mounted) c.remove();
  mounted.clear();
  collapseAll.reset();
  document.documentElement.removeAttribute("data-otfw-has-sidebar");
  delete window.__otfwToggleSidebar;
  delete window.__otfwCloseSidebar;
});

describe("sidebar collapse-all button", () => {
  test("renders only when the tree has collapsible groups", async () => {
    const flat = mount([{ title: "Introduction", path: "/docs" }]);
    await tick();
    expect(button()).toBeNull();
    flat.unmount();

    mount();
    await tick();
    expect(button()).not.toBeNull();
    expect(button().getAttribute("aria-label")).toBe("Collapse all sections");
  });

  test("one press collapses every group and flips the button to expand", async () => {
    mount();
    await tick();
    // Top-level groups start expanded, the nested one collapsed.
    expect(toggleFor("Guide").getAttribute("aria-expanded")).toBe("true");
    expect(toggleFor("Concepts").getAttribute("aria-expanded")).toBe("false");
    expect(toggleFor("Reference").getAttribute("aria-expanded")).toBe("true");

    button().click();
    await tick();

    // Collapsing the top level takes the nested toggles out of the DOM with it.
    expect(toggles().map((b) => b.textContent.trim())).toEqual(["Guide", "Reference"]);
    expect(expandedFlags()).toEqual(["false", "false"]);
    expect(aside().querySelector(".otfw-sidebar-sublist")).toBeNull();
    expect(button().getAttribute("aria-label")).toBe("Expand all sections");
  });

  test("pressing again expands the whole tree, nested groups included", async () => {
    mount();
    await tick();
    button().click();
    await tick();
    button().click();
    await tick();

    // `Concepts` only mounts once `Guide` is open again — and it comes up expanded too,
    // so the expand cascades all the way down rather than stopping at the top level.
    expect(toggleFor("Concepts")).not.toBeUndefined();
    expect(expandedFlags().every((v) => v === "true")).toBe(true);
    expect(aside().textContent).toContain("Deep");
    expect(button().getAttribute("aria-label")).toBe("Collapse all sections");
  });

  test("re-collapses a group that was re-opened by hand", async () => {
    mount();
    await tick();
    button().click();
    await tick();

    toggleFor("Guide").click();
    await tick();
    expect(toggleFor("Guide").getAttribute("aria-expanded")).toBe("true");

    // The button still reads "expand all" (collapse-all is still the standing command),
    // so press it twice: back to fully expanded, then collapsed again.
    button().click();
    await tick();
    button().click();
    await tick();
    expect(expandedFlags().every((v) => v === "false")).toBe(true);
  });

  test("a press collapses the branch holding the active route too", async () => {
    // Otherwise, reading a page inside the only open branch, the press would leave the
    // tree looking untouched.
    setRouteState({ pathname: "/docs/guide/concepts/deep" });
    mount();
    await tick();
    expect(toggleFor("Concepts").getAttribute("aria-expanded")).toBe("true");

    button().click();
    await tick();

    expect(expandedFlags().every((v) => v === "false")).toBe(true);
    expect(aside().textContent).not.toContain("Deep");
  });

  test("a re-mount under a standing collapse-all still opens the active branch", async () => {
    // SPA navigation rebuilds the tree: the collapse sticks, but the branch holding the
    // new route opens, exactly as it does with the button untouched.
    const first = mount();
    await tick();
    button().click();
    await tick();
    first.unmount();

    setRouteState({ pathname: "/docs/guide/concepts/deep" });
    mount();
    await tick();

    expect(toggleFor("Guide").getAttribute("aria-expanded")).toBe("true");
    expect(toggleFor("Concepts").getAttribute("aria-expanded")).toBe("true");
    expect(toggleFor("Reference").getAttribute("aria-expanded")).toBe("false");
    expect(aside().textContent).toContain("Deep");
  });

  test("the collapsed state survives a re-mount (SPA navigation)", async () => {
    const first = mount();
    await tick();
    button().click();
    await tick();
    first.unmount();

    mount();
    await tick();

    expect(toggles().map((b) => b.textContent.trim())).toEqual(["Guide", "Reference"]);
    expect(expandedFlags()).toEqual(["false", "false"]);
    expect(button().getAttribute("aria-label")).toBe("Expand all sections");
  });
});
