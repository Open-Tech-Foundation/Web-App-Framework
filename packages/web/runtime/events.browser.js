import { describe, expect, test } from "../../web-test/browser-runner.js";

import { emit } from "./events.js";

describe("emit", () => {
  test("dispatches a bubbling, composed CustomEvent carrying detail", () => {
    const parent = document.createElement("div");
    const child = document.createElement("button");
    parent.appendChild(child);
    document.body.appendChild(parent);

    let seen;
    parent.addEventListener("select", (e) => (seen = e));
    emit(child, "select", { id: 7 });

    expect(seen).toBeDefined(); // bubbled to the parent
    expect(seen.detail).toEqual({ id: 7 });
    expect(seen.bubbles).toBe(true);
    expect(seen.composed).toBe(true);
    parent.remove();
  });

  test("returns false when a listener preventDefaults a cancelable event", () => {
    const el = document.createElement("div");
    el.addEventListener("act", (e) => e.preventDefault());
    expect(emit(el, "act", null, { cancelable: true })).toBe(false);
    expect(emit(el, "noop", null)).toBe(true);
  });
});
