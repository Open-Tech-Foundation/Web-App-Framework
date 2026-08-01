// Unit tests for the SSG runtime's hydration-props collector (docs/HYDRATION.md §3.7):
// `ssgComponent` stamps each island a `data-h` id and records its JSON-safe props into a
// payload the client reads at upgrade. No DOM — plain string building.

import { afterEach, describe, expect, test } from "bun:test";

import {
  beginHydrationCollect,
  defineSSG,
  endHydrationCollect,
  ssgComponent,
  ssgText,
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

  test("carries props inline when rendered outside a render (no beginHydrationCollect)", () => {
    // Module-level JSX-as-value (`export const tabs = [{ content: <CodeBlock/> }]`) renders
    // at import time, before any collect bracket: there is no payload to key an id into, so
    // the props ride on the host and the markup stays self-contained wherever it is spliced.
    const tag = register("web-off", () => "x");
    const html = ssgComponent(tag, { label: "hi" }, "");
    expect(html).not.toContain("data-h=");
    expect(html).toContain('data-hp="{&quot;label&quot;:&quot;hi&quot;}"');
    expect(endHydrationCollect()).toBe(""); // nothing was collecting
  });

  test("an inline prop value can't break out of its attribute", () => {
    const tag = register("web-off-xss", () => "x");
    const html = ssgComponent(tag, { s: '"><img src=x onerror=alert(1)>' }, "");
    expect(html).not.toContain("<img");
    // The quote that would close the attribute and the `<` that would start a tag are
    // both entities, so the whole value stays inside `data-hp="…"`.
    expect(html.match(/data-hp="[^"]*"/)[0]).toContain("\\&quot;>&lt;img");
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

  test("a renderer's hostAttrs land on the host tag", () => {
    // The escape hatch built-ins need when an attribute has to be in the served
    // HTML before any script runs — see `web-internal-context-provider`, resolved
    // by `closest()` at custom-element upgrade time (server/builtins.js).
    const render = (_p, children) => children;
    render.hostAttrs = (p) => (p.context ? ` data-otfw-ctx="${p.context.id}"` : "");
    defineSSG("web-hostattrs", render);
    expect(ssgComponent("web-hostattrs", { context: { id: "otfw-ctx-3" } }, "x")).toContain(
      'data-otfw-ctx="otfw-ctx-3"',
    );
    expect(ssgComponent("web-hostattrs", {}, "x")).not.toContain("data-otfw-ctx");
  });
});

describe("built-in SSG renderers", () => {
  test("ContextProvider publishes its context id as a host attribute", async () => {
    // Without this attribute in the markup, consumer elements — which upgrade before
    // the enclosing component's hydrate code assigns the `context` prop — resolve no
    // provider and silently bind to the context default for the life of the page.
    await import("./builtins.js");
    const html = ssgComponent(
      "web-internal-context-provider",
      { context: { id: "otfw-ctx-0" }, value: "high-contrast" },
      "<span>x</span>",
    );
    expect(html).toContain('data-otfw-ctx="otfw-ctx-0"');
    expect(html).toContain("<span>x</span>");
  });
});

describe("ssgText", () => {
  test("nullish / boolean holes render empty", () => {
    for (const v of [null, undefined, false, true]) expect(ssgText(v)).toBe("");
  });

  test("escapes plain text but passes {__html} through raw", () => {
    expect(ssgText("<b>hi</b>")).toBe("&lt;b&gt;hi&lt;/b&gt;");
    expect(ssgText({ __html: "<b>hi</b>" })).toBe("<b>hi</b>");
    expect(ssgText(42)).toBe("42");
  });

  // Regression: an inline array hole (`{[<a/>, <b/>]}` or `{[1,2,3]}`) used to fall
  // through to `String(v)` → "[object Object]" / comma-joined text. It must render
  // each item concatenated with no separator, mirroring CSR's toNodes/bindText so the
  // hydrated client render matches the server HTML.
  test("an array of JSX holes concatenates each item's HTML (no [object Object])", () => {
    const out = ssgText([{ __html: "<span>A</span>" }, { __html: "<span>B</span>" }]);
    expect(out).toBe("<span>A</span><span>B</span>");
    expect(out).not.toContain("[object Object]");
  });

  test("an array of primitives concatenates with no separator (matches CSR)", () => {
    expect(ssgText([1, 2, 3])).toBe("123");
    expect(ssgText(["a", null, "b", false])).toBe("ab"); // nullish/false items drop out
  });

  test("nested arrays flatten and text items stay escaped", () => {
    expect(ssgText([["<x>", { __html: "<i>ok</i>" }], "y"])).toBe("&lt;x&gt;<i>ok</i>y");
  });
});
