import { describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import { bindText } from "./dom.js";
import {
  HydrationMismatch,
  claimElement,
  claimText,
  cursor,
  isHydrating,
  runHydration,
  skipNode,
} from "./hydrate.js";

// Build a real DOM subtree from a server HTML string (as the browser would on load).
function serverDom(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("the hydration flag", () => {
  test("isHydrating is false outside a pass and true inside runHydration", () => {
    expect(isHydrating()).toBe(false);
    let inside = null;
    runHydration(() => (inside = isHydrating()));
    expect(inside).toBe(true);
    expect(isHydrating()).toBe(false);
  });

  test("runHydration restores the prior value (nesting-safe) and returns fn's result", () => {
    const seen = [];
    const out = runHydration(() => {
      seen.push(isHydrating()); // true
      runHydration(() => seen.push(isHydrating())); // true
      seen.push(isHydrating()); // still true after the inner pass
      return 42;
    });
    expect(seen).toEqual([true, true, true]);
    expect(out).toBe(42);
    expect(isHydrating()).toBe(false);
  });
});

describe("claimElement", () => {
  test("claims the next element, asserts its tag, and advances the cursor", () => {
    const host = serverDom("<section></section><span></span>");
    const cur = cursor(host);
    const section = claimElement(cur, "section");
    expect(section).toBe(host.firstChild);
    const span = claimElement(cur, "span");
    expect(span.tagName.toLowerCase()).toBe("span");
    expect(cur.node).toBe(null); // walked off the end
  });

  test("throws HydrationMismatch on a wrong tag or a missing node", () => {
    const host = serverDom("<p></p>");
    const cur = cursor(host);
    expect(() => claimElement(cur, "div")).toThrow(HydrationMismatch);
    const empty = cursor(serverDom(""));
    expect(() => claimElement(empty, "div")).toThrow(HydrationMismatch);
  });
});

describe("claimText", () => {
  test("adopts the server text node inside <!--$-->…<!--/--> markers", () => {
    const host = serverDom("Count <!--$-->5<!--/-->");
    const cur = cursor(host);
    skipNode(cur); // the static "Count " text
    const textNode = claimText(cur);
    expect(textNode.nodeType).toBe(3);
    expect(textNode.data).toBe("5");
    expect(cur.node).toBe(null); // advanced past the closing marker
  });

  test("synthesizes an empty anchor when the server rendered no value", () => {
    const host = serverDom("<!--$--><!--/-->");
    const cur = cursor(host);
    const textNode = claimText(cur);
    expect(textNode.nodeType).toBe(3);
    expect(textNode.data).toBe("");
    // The synthesized node lives between the markers, in the real tree.
    expect(textNode.parentNode).toBe(host);
  });

  test("throws when the start marker is absent", () => {
    const cur = cursor(serverDom("<span></span>"));
    expect(() => claimText(cur)).toThrow(HydrationMismatch);
  });
});

describe("integrated walk — adopt, don't rebuild", () => {
  test("hydrating <div><h1>Count {n}</h1></div> adopts nodes and wires reactivity", () => {
    // What the SSG/SSR backend emits for `<div class="box"><h1>Count {n}</h1></div>`
    // with n initially 3.
    const host = serverDom('<div class="box"><h1>Count <!--$-->3<!--/--></h1></div>');
    const div = host.firstChild;
    const h1 = div.firstChild;
    const serverText = h1.childNodes[2]; // "Count ", <!--$-->, "3", <!--/-->

    const n = signal(3); // client signal initializes to the same value the server used
    let boundNode = null;

    runHydration(() => {
      const root = cursor(host);
      const claimedDiv = claimElement(root, "div");
      const inner = cursor(claimedDiv);
      const claimedH1 = claimElement(inner, "h1");
      const h1cur = cursor(claimedH1);
      skipNode(h1cur); // "Count "
      boundNode = claimText(h1cur);
      bindText(boundNode, () => n.value);
    });

    // Adoption: the very same server nodes were claimed — nothing was re-created.
    expect(boundNode).toBe(serverText);
    expect(host.firstChild).toBe(div);
    expect(div.firstChild).toBe(h1);
    expect(host.querySelectorAll("div").length).toBe(1);
    expect(host.querySelectorAll("h1").length).toBe(1);

    // Reactivity is now live on the adopted text node.
    n.value = 7;
    expect(serverText.data).toBe("7");
    // Still the same node identity after the update (no replacement).
    expect(h1.childNodes[2]).toBe(serverText);
  });
});
