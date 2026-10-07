// <Tabs> follows the WAI-ARIA tabs pattern: roles and selection state, tab/panel
// id links, one tab stop, and keyboard selection with wrapping.

import { describe, expect, test } from "runtime:test";
import { render } from "@opentf/web-test";
import Tabs from "../components/Tabs.jsx";

const TABS = [
  { label: "npm", content: "npm install" },
  { label: "pnpm", content: "pnpm add" },
  { label: "yarn", content: "yarn add" },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const key = (el, name) => el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

function setup(props = { tabs: TABS, label: "Package manager" }) {
  const view = render(Tabs, props);
  const list = view.getByRole("tablist");
  const tabs = () => view.getAllByRole("tab");
  const panels = () => Array.from(view.container.querySelectorAll('[role="tabpanel"]'));
  return { ...view, list, tabs, panels };
}

function expectSelected({ tabs, panels }, index) {
  tabs().forEach((tab, i) => {
    expect(tab.getAttribute("aria-selected")).toBe(i === index ? "true" : "false");
    expect(tab.getAttribute("tabindex")).toBe(i === index ? "0" : "-1");
  });
  panels().forEach((panel, i) => expect(panel.hidden).toBe(i !== index));
}

describe("Tabs", () => {
  test("renders an accessible tab list with the first tab selected", async () => {
    const view = setup();
    await tick();
    expect(view.list.getAttribute("aria-label")).toBe("Package manager");
    expect(view.tabs().map((tab) => tab.textContent.trim())).toEqual(["npm", "pnpm", "yarn"]);
    expect(view.tabs().every((tab) => tab.getAttribute("type") === "button")).toBe(true);
    expectSelected(view, 0);
  });

  test("links each tab to its panel with unique ids", async () => {
    const first = setup();
    const second = setup();
    await tick();
    for (const view of [first, second]) {
      view.tabs().forEach((tab, i) => {
        const panel = view.panels()[i];
        expect(tab.getAttribute("aria-controls")).toBe(panel.id);
        expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
      });
    }
    expect(first.tabs()[0].id).not.toBe(second.tabs()[0].id);
  });

  test("clicking a tab selects it and shows its panel", async () => {
    const view = setup();
    view.tabs()[1].click();
    await tick();
    expectSelected(view, 1);
    expect(view.panels()[1].textContent).toContain("pnpm add");
  });

  test("arrow keys move and wrap, Home and End jump, and focus follows", async () => {
    const view = setup();
    view.tabs()[0].focus();
    key(view.tabs()[0], "ArrowRight");
    await tick();
    expectSelected(view, 1);
    expect(document.activeElement).toBe(view.tabs()[1]);
    key(view.tabs()[1], "End");
    await tick();
    expectSelected(view, 2);
    key(view.tabs()[2], "ArrowRight");
    await tick();
    expectSelected(view, 0);
    key(view.tabs()[0], "ArrowLeft");
    await tick();
    expectSelected(view, 2);
    key(view.tabs()[2], "Home");
    await tick();
    expectSelected(view, 0);
    expect(document.activeElement).toBe(view.tabs()[0]);
  });

  test("ignores other keys and an empty tab set", async () => {
    const view = setup();
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    view.tabs()[0].dispatchEvent(event);
    await tick();
    expect(event.defaultPrevented).toBe(false);
    expectSelected(view, 0);
    const empty = setup({ tabs: [] });
    key(empty.list, "ArrowRight");
    expect(empty.container.querySelectorAll('[role="tab"]').length).toBe(0);
  });
});
