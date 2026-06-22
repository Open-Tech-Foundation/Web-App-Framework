import { describe, expect, test } from "bun:test";

import { createContext, enterHost, exitHost, readContext } from "./context.js";
import "./portal.js";

// A <web-internal-portal> wrapping `child`, with an optional target selector.
function portal(child, to) {
  const p = document.createElement("web-internal-portal");
  if (to !== undefined) p.to = to;
  p.appendChild(child);
  return p;
}

describe("portal", () => {
  test("moves children to the default target (body) and removes them on teardown", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const modal = document.createElement("section");
    modal.id = "modal";
    const p = portal(modal);
    host.appendChild(p); // connect fires → relocate

    // The modal moved to body; the portal element itself stays as the anchor.
    expect(modal.parentNode).toBe(document.body);
    expect(p.contains(modal)).toBe(false);

    p.remove(); // disconnect → relocated content removed
    expect(modal.parentNode).toBe(null);
    host.remove();
  });

  test("honors a selector target", () => {
    const root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);

    const toast = document.createElement("div");
    const p = portal(toast, "#toast-root");
    document.body.appendChild(p);

    expect(toast.parentNode).toBe(root);
    p.remove();
    root.remove();
  });

  test("preserves context across the portal boundary", () => {
    const Theme = createContext("dark");

    // A consumer custom element that resolves context at connect time.
    let resolved;
    customElements.define(
      "web-portal-consumer",
      class extends HTMLElement {
        connectedCallback() {
          enterHost(this);
          try {
            resolved = readContext(Theme);
          } finally {
            exitHost();
          }
        }
      },
    );

    // <provider value="light"> <web-internal-portal> <consumer/> </web-internal-portal> </provider>
    const provider = document.createElement("web-internal-context-provider");
    provider.context = Theme;
    provider.value = "light";
    const consumer = document.createElement("web-portal-consumer");
    const p = portal(consumer);
    provider.appendChild(p);
    document.body.appendChild(provider); // connect: provider → portal moves consumer to body

    // The consumer physically lives in body now, but still resolves the provider
    // above the <Portal> in the logical tree.
    expect(consumer.parentNode).toBe(document.body);
    expect(resolved.value).toBe("light");

    provider.value = "solar"; // still wired to the provider signal
    expect(resolved.value).toBe("solar");
    p.remove();
    provider.remove();
  });
});
