// Unit tests for the SSG runtime's hydration-props collector (docs/HYDRATION.md §3.7):
// `ssgComponent` stamps each island a `data-h` id and records its JSON-safe props into a
// payload the client reads at upgrade. No DOM — plain string building.

import { afterEach, describe, expect, test } from "bun:test";

import {
  beginHydrationCollect,
  defineSSG,
  endHydrationCollect,
  ssgComponent,
} from "./ssg-runtime.js";

// A render fn as the SSG backend emits: props → inner HTML, with a stable host class.
function register(tag, render) {
  render.hostClass = "hook-" + tag;
  defineSSG(tag, render);
  return tag;
}

afterEach(() => {
  endHydrationCollect(); // clear any collector left open by a failing test
});

describe("ssgComponent + hydration collector", () => {
  test("stamps a data-h id and serializes rich props into the payload", () => {
    const tag = register("web-badge", (p) => `<span>${p.meta.text}</span>`);
    beginHydrationCollect();
    const html = ssgComponent(tag, { meta: { text: "hi", n: 7 } }, "");
    const payload = endHydrationCollect();

    expect(html).toMatch(/<web-badge class="hook-web-badge" data-h="0">/);
    expect(html).not.toContain("meta="); // the rich prop is NOT a host attribute
    expect(JSON.parse(payload)).toEqual([{ meta: { text: "hi", n: 7 } }]);
  });

  test("assigns ids in call order across multiple islands", () => {
    const a = register("web-a", () => "A");
    const b = register("web-b", () => "B");
    beginHydrationCollect();
    const html = ssgComponent(a, { x: 1 }, "") + ssgComponent(b, { y: 2 }, "");
    const payload = endHydrationCollect();

    expect(html).toContain('data-h="0"');
    expect(html).toContain('data-h="1"');
    expect(JSON.parse(payload)).toEqual([{ x: 1 }, { y: 2 }]);
  });

  test("drops function props and stamps no id when nothing serializes", () => {
    const tag = register("web-cb", () => "x");
    beginHydrationCollect();
    const html = ssgComponent(tag, { onClick: () => {}, onInput: () => {} }, "");
    const payload = endHydrationCollect();

    // All props were callbacks (client-only, dropped by JSON) → no id, no payload.
    expect(html).not.toContain("data-h");
    expect(payload).toBe("");
  });

  test("keeps serializable props and drops the callbacks alongside them", () => {
    const tag = register("web-mix", () => "x");
    beginHydrationCollect();
    ssgComponent(tag, { label: "hi", onClick: () => {} }, "");
    expect(JSON.parse(endHydrationCollect())).toEqual([{ label: "hi" }]); // no onClick
  });

  test("does not stamp ids or collect when not in a render (no beginHydrationCollect)", () => {
    const tag = register("web-off", () => "x");
    const html = ssgComponent(tag, { label: "hi" }, "");
    expect(html).not.toContain("data-h");
    expect(endHydrationCollect()).toBe(""); // nothing was collecting
  });

  test("escapes `<` so a prop value can't break out of the payload <script>", () => {
    const tag = register("web-xss", () => "x");
    beginHydrationCollect();
    ssgComponent(tag, { s: "</script><!--" }, "");
    const payload = endHydrationCollect();
    expect(payload).not.toContain("</script>");
    expect(payload).toContain("\\u003c/script>");
    expect(JSON.parse(payload)).toEqual([{ s: "</script><!--" }]); // still valid JSON
  });

  test("a cyclic / non-serializable prop object yields no id (client falls back)", () => {
    const tag = register("web-cyc", () => "x");
    const cyclic = {};
    cyclic.self = cyclic;
    beginHydrationCollect();
    const html = ssgComponent(tag, cyclic, "");
    expect(html).not.toContain("data-h");
    expect(endHydrationCollect()).toBe("");
  });
});
