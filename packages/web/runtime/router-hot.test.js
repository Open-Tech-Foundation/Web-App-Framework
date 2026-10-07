// Development route refresh (esdev `import.meta.hot`): an edited page or layout
// rebuilds alone, keeps its `$state` when the declarations match, and leaves the
// rest of the route view — outer layouts, the inner page and their state — in place.

import { afterEach, expect, test } from "runtime:test";
import { effect, signal } from "../core/signals.js";
import { hotRouteState, registerHotRoute } from "./hmr.js";
import { mountApp, routes } from "./router.js";

const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// The slice of esdev's `import.meta.hot` the route runtime uses.
function fakeHot() {
  return {
    data: {}, accepted: 0, invalidated: 0,
    keep(key, create) { return (this.data[key] ??= create()); },
    accept() { this.accepted++; },
    invalidate() { this.invalidated++; },
  };
}

const log = [];
// A page factory version: `$state` count kept in route slots, a button to change it.
function pageVersion(label, stateName = "count") {
  return () => {
    const count = hotRouteState(stateName, () => signal(0));
    const root = document.createElement("section");
    root.className = "page";
    const text = document.createTextNode("");
    effect(() => { text.data = `${label}:${count.value}`; });
    const button = document.createElement("button");
    button.className = "inc";
    button.onclick = () => count.value++;
    root.append(text, button);
    root.__lifecycle = { mounts: [() => { log.push(`mount ${label}`); return () => log.push(`cleanup ${label}`); }], cleanups: [] };
    return root;
  };
}
function layoutVersion(label, { fail = false } = {}) {
  return (props) => {
    const open = hotRouteState("open", () => signal(1));
    const root = document.createElement("main");
    root.className = "layout";
    const head = document.createElement("p");
    head.className = "head";
    effect(() => { head.textContent = `${label}:${open.value}`; });
    root.append(head, props.children);
    if (fail) throw new Error("layout broke");
    return root;
  };
}

let app;
async function mountRoute(pageHot, layoutHot, pageV1, layoutV1) {
  routes.pages = {}; routes.layouts = {}; routes.notFound = null;
  app = document.createElement("div");
  document.body.appendChild(app);
  window.history.replaceState({}, "", "/");
  const pages = { "/app/page.jsx": { default: registerHotRoute(pageHot, pageV1, true, '["count:State"]') } };
  if (layoutHot) pages["/app/layout.jsx"] = { default: registerHotRoute(layoutHot, layoutV1, true, '["open:State"]') };
  await mountApp({ target: app, pages });
  await tick();
}
const logged = (...labels) => log.filter((entry) => labels.includes(entry.split(" ")[1]));
const text = (selector) => app.querySelector(selector)?.firstChild?.data ?? app.querySelector(selector)?.textContent;

afterEach(() => {
  app?.remove();
  log.length = 0;
  window.history.replaceState({}, "", "/");
});

test("a page edit keeps its state and leaves the layout untouched", async () => {
  const pageHot = fakeHot(), layoutHot = fakeHot();
  await mountRoute(pageHot, layoutHot, pageVersion("A"), layoutVersion("L"));
  app.querySelector(".inc").click(); app.querySelector(".inc").click();
  const layout = app.querySelector(".layout");
  const head = app.querySelector(".head");
  expect(text(".page")).toBe("A:2");

  registerHotRoute(pageHot, pageVersion("B"), true, '["count:State"]');
  await tick();

  expect(text(".page")).toBe("B:2");
  expect(app.querySelector(".layout")).toBe(layout);
  expect(app.querySelector(".head")).toBe(head);
  expect(logged("A", "B")).toEqual(["mount A", "cleanup A", "mount B"]);
  expect(pageHot.invalidated).toBe(0);
});

test("a page edit that changes its state declarations starts fresh", async () => {
  const pageHot = fakeHot();
  await mountRoute(pageHot, null, pageVersion("A"));
  app.querySelector(".inc").click();
  expect(text(".page")).toBe("A:1");

  registerHotRoute(pageHot, pageVersion("B", "total"), true, '["total:State"]');
  await tick();

  expect(text(".page")).toBe("B:0");
});

test("a layout edit keeps the page node, the page state and the layout state", async () => {
  const pageHot = fakeHot(), layoutHot = fakeHot();
  await mountRoute(pageHot, layoutHot, pageVersion("P"), layoutVersion("L1"));
  app.querySelector(".inc").click();
  const pageNode = app.querySelector(".page");
  const oldLayout = app.querySelector(".layout");
  // Bump the layout's own state through its slot-backed signal.
  const slots = oldLayout.__otfwHotSlots.slots;
  slots.get("open").value = 5;
  expect(text(".head")).toBe("L1:5");

  registerHotRoute(layoutHot, layoutVersion("L2"), true, '["open:State"]');
  await tick();

  const newLayout = app.querySelector(".layout");
  expect(newLayout).not.toBe(oldLayout);
  expect(text(".head")).toBe("L2:5");
  expect(app.querySelector(".page")).toBe(pageNode);
  expect(newLayout.contains(pageNode)).toBe(true);
  expect(text(".page")).toBe("P:1");
  expect(logged("P")).toEqual(["mount P"]); // the page never remounted
  // The old layout's bindings are disposed: changing its state no longer writes.
  slots.get("open").value = 6;
  expect(text(".head")).toBe("L2:6");
  expect(oldLayout.querySelector(".head").textContent).toBe("L1:5");
});

test("a failed layout rebuild keeps the current view and its page", async () => {
  const pageHot = fakeHot(), layoutHot = fakeHot();
  await mountRoute(pageHot, layoutHot, pageVersion("P"), layoutVersion("L1"));
  const pageNode = app.querySelector(".page");
  const layout = app.querySelector(".layout");
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    registerHotRoute(layoutHot, layoutVersion("L2", { fail: true }), true, '["open:State"]');
    await tick();
  } finally {
    console.error = original;
  }
  expect(app.querySelector(".layout")).toBe(layout);
  expect(layout.contains(pageNode)).toBe(true);
  expect(text(".head")).toBe("L1:1");
});

test("editing a factory that is not on screen changes nothing", async () => {
  const pageHot = fakeHot(), otherHot = fakeHot();
  registerHotRoute(otherHot, pageVersion("Other"), true, '["count:State"]');
  await mountRoute(pageHot, null, pageVersion("A"));
  const node = app.querySelector(".page");
  registerHotRoute(otherHot, pageVersion("Other2"), true, '["count:State"]');
  await tick();
  expect(app.querySelector(".page")).toBe(node);
  expect(text(".page")).toBe("A:0");
});
