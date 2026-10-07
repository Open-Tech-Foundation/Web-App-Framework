// The Portal guide's custom overlay must behave as a modal dialog.
// Run from website/: esdev test --dom tests

import { afterEach, expect, test } from "runtime:test";
import PortalDemo from "../app/components/PortalDemo.jsx";

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (el, name, init = {}) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
};

function mount() {
  const app = document.createElement("div");
  app.id = "app";
  app.appendChild(document.createElement(PortalDemo.tag));
  document.body.appendChild(app);
  const opener = [...app.querySelectorAll("button")].find((b) => b.textContent.includes("Open portaled modal"));
  return { app, opener };
}

async function open() {
  const view = mount();
  view.opener.focus();
  view.opener.click();
  await wait();
  const dialog = document.querySelector('[role="dialog"]');
  return { ...view, dialog, close: dialog?.querySelector("button") };
}

afterEach(() => {
  document.body.replaceChildren();
});

test("opens a labelled modal dialog outside the page and moves focus into it", async () => {
  const { app, dialog, close } = await open();
  expect(dialog).toBeTruthy();
  expect(app.contains(dialog)).toBe(false);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")).textContent).toBe("Portaled modal");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")).textContent).toContain("Lives under");
  expect(document.activeElement).toBe(close);
  expect(app.inert).toBe(true);
});

test("Tab and Shift+Tab stay inside the dialog", async () => {
  const { close } = await open();
  const forward = key(close, "Tab");
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  const back = key(close, "Tab", { shiftKey: true });
  expect(back.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
});

test("Escape closes the dialog, restores the page and returns focus to the opener", async () => {
  const { app, opener, close } = await open();
  key(close, "Escape");
  await wait();
  expect(document.querySelector('[role="dialog"]')).toBe(null);
  expect(app.inert).toBe(false);
  expect(document.activeElement).toBe(opener);
});

test("the backdrop and the Close button close it; clicks inside do not", async () => {
  const first = await open();
  first.dialog.click();
  await wait();
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  first.dialog.parentElement.click();
  await wait();
  expect(document.querySelector('[role="dialog"]')).toBe(null);
  expect(document.activeElement).toBe(first.opener);

  first.opener.click();
  await wait();
  document.querySelector('[role="dialog"] button').click();
  await wait();
  expect(document.querySelector('[role="dialog"]')).toBe(null);
  expect(first.app.inert).toBe(false);
});

test("other keys are left alone", async () => {
  const { close } = await open();
  expect(key(close, "a").defaultPrevented).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
});
