// End-to-end hydration test (Phase 2.0 — see docs/HYDRATION.md). Proves the two
// backends compose: the SSG backend's server HTML (with text-hole markers) is *adopted*
// by the Hydrate backend's factory — the very same nodes, no rebuild — and reactivity
// then runs live on them, driven by a real DOM event.
//
// Unlike the rest of the suite (which compiles `.jsx` fixtures via the preload), this
// drives the otfwc binary directly so it can request the ssg/hydrate targets. It is
// skipped when the workspace debug build is absent (OTFWC_BIN overrides the path).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import { signal } from "../core/signals.js";
import { ssgText } from "../server/ssg-runtime.js";
import { bindText, claimElement, claimText, cursor, skipNode } from "./index.js";

function findUp(name, from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const workspace = findUp("Cargo.toml", import.meta.dir);
const OTFWC = process.env.OTFWC_BIN ?? (workspace ? join(workspace, "target", "debug", "otfwc") : "otfwc");
const hasBin = existsSync(OTFWC);

// Compile `source` with otfwc for `target` (ssg | hydrate), returning the emitted JS.
function compile(source, target) {
  const proc = Bun.spawnSync([OTFWC, "build", `--target=${target}`, "--stdin", "/app/page.tsx"], {
    stdin: new TextEncoder().encode(source),
  });
  if (proc.exitCode !== 0) throw new Error(`otfwc ${target} failed:\n${proc.stderr}`);
  return proc.stdout.toString();
}

// Load a module's `export default` factory, injecting the runtime helpers it imports
// (the emitted code uses bare `@opentf/web` specifiers; we supply the real bindings).
function loadDefault(code, bindings) {
  const body = code
    .split("\n")
    .filter((l) => !l.startsWith("import "))
    .join("\n")
    .replace("export default function", "return function");
  const names = Object.keys(bindings);
  return new Function(...names, body)(...names.map((n) => bindings[n]));
}

describe.skipIf(!hasBin)("hydration e2e (ssg → hydrate)", () => {
  // A counter so reactivity can be driven through a real DOM event on an adopted node.
  const source =
    'export default function P(){ let n=$state(3); return <div class="box"><button onclick={() => n++}>Count {n}</button></div>; }';

  test("the Hydrate factory adopts the SSG-rendered DOM and wires reactivity onto it", () => {
    // 1. Server render (SSG) → HTML string with text-hole markers.
    const ssgFactory = loadDefault(compile(source, "ssg"), { signal, ssgText });
    const html = ssgFactory();
    expect(html).toContain("<!--$-->3<!--/-->"); // value bracketed by hydration markers
    expect(html).not.toContain("onclick"); // event handler is client-only, never serialized

    // 2. Put it in the DOM as the browser would, and snapshot the server nodes.
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverDiv = container.firstChild;
    const serverButton = serverDiv.firstChild;
    const serverText = serverButton.childNodes[2]; // "Count ", <!--$-->, "3", <!--/-->
    expect(serverText.data).toBe("3");

    // 3. Hydrate over the existing container.
    const hydrate = loadDefault(compile(source, "hydrate"), {
      signal,
      bindText,
      cursor,
      claimElement,
      claimText,
      skipNode,
    });
    const root = hydrate(container);

    // 4. Adoption — the same server nodes were claimed; nothing was re-created.
    expect(root).toBe(serverDiv);
    expect(serverDiv.firstChild).toBe(serverButton);
    expect(container.querySelectorAll("div").length).toBe(1);
    expect(container.querySelectorAll("button").length).toBe(1);
    expect(serverText.data).toBe("3"); // no flash / reset

    // 5. Reactivity is live on the adopted DOM: clicking the server-rendered button
    //    increments the signal and updates the *same* text node in place.
    serverButton.click();
    expect(serverText.data).toBe("4");
    expect(serverButton.childNodes[2]).toBe(serverText); // identity unchanged after update
  });
});
