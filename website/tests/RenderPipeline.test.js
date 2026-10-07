// The homepage render-pipeline tour pauses while hovered and resumes on leave.
// Run from website/: esdev test --dom tests

import { afterEach, expect, test } from "runtime:test";
import RenderPipeline from "../app/components/RenderPipeline.jsx";

const TOUR_MS = 3400;
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

let host;
function mount() {
  host = document.createElement(RenderPipeline.tag);
  document.body.appendChild(host);
  const panel = host.firstElementChild;
  const framework = () => host.querySelector('[data-pl="left"] .pipe-stack-head').textContent.trim();
  return { panel, framework };
}

afterEach(() => {
  host?.remove();
  host = null;
});

test("has no tour controls", () => {
  mount();
  expect(host.querySelectorAll("button").length).toBe(0);
});

test("the tour advances, pauses while hovered and resumes on leave", async () => {
  if (reducedMotion()) return; // the tour never runs under reduced motion
  const { panel, framework } = mount();
  expect(framework()).toBe("React");
  await wait(TOUR_MS + 300);
  const advanced = framework();
  expect(advanced).not.toBe("React");

  panel.dispatchEvent(new MouseEvent("mouseenter"));
  await wait(TOUR_MS + 300);
  expect(framework()).toBe(advanced);

  panel.dispatchEvent(new MouseEvent("mouseleave"));
  await wait(TOUR_MS + 300);
  expect(framework()).not.toBe(advanced);
});

test("leaving twice does not start a second tour", async () => {
  if (reducedMotion()) return;
  const { panel, framework } = mount();
  panel.dispatchEvent(new MouseEvent("mouseenter"));
  panel.dispatchEvent(new MouseEvent("mouseleave"));
  panel.dispatchEvent(new MouseEvent("mouseleave"));
  await wait(TOUR_MS + 300);
  // One interval advances one step per period; a duplicate would advance two.
  expect(framework()).toBe("Vue");
});

test("unmounting stops the tour", async () => {
  mount();
  const stack = host.querySelector('[data-pl="left"] .pipe-stack-head');
  host.remove();
  await wait(TOUR_MS + 300);
  expect(stack.textContent.trim()).toBe("React");
});
