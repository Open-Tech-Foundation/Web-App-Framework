// Unit tests for the route-loader toolchain plumbing (docs/DATA.md): discovery of
// `loader.{js,ts}` files, route derivation, misplacement detection, the generated
// entry sources, and the `#__otfw_data` shell injection.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  detectLoaderConflicts,
  discoverLoaders,
  entrySource,
  injectRouteData,
  loaderEntrySource,
  loaderRoutePath,
} from "../src/shared.js";

const root = join(tmpdir(), `otfw-loader-discovery-${process.pid}`);
const appDir = join(root, "app");

function file(rel, content = "") {
  const full = join(appDir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  // A well-formed app: pages with loaders (static + dynamic), a loader-less page,
  // an API route, and files that must NOT be discovered as loaders.
  file("page.jsx", "export default () => {}");
  file("todos/page.jsx", "export default () => {}");
  file("todos/loader.js", "export default () => []");
  file("items/[id]/page.tsx", "export default () => {}");
  file("items/[id]/loader.ts", "export default () => null");
  file("about/page.jsx", "export default () => {}");
  file("api/hello/route.js", "export const GET = () => Response.json(1)");
  file("todos/loader.jsx", "not a loader (x-variants are JSX, loaders are plain js/ts)");
  file("todos/notloader.js", "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("discoverLoaders + loaderRoutePath", () => {
  test("finds loader.{js,ts} anywhere under app/, nothing else", () => {
    const found = discoverLoaders(appDir).map((f) => loaderRoutePath(f, appDir));
    expect(found.sort()).toEqual(["/items/[id]", "/todos"]);
  });

  test("respects the exclude set", () => {
    expect(discoverLoaders(appDir, new Set(["todos"])).map((f) => loaderRoutePath(f, appDir))).toEqual([
      "/items/[id]",
    ]);
  });

  test("a root loader maps to /", () => {
    expect(loaderRoutePath(join(appDir, "loader.js"), appDir)).toBe("/");
  });
});

describe("detectLoaderConflicts", () => {
  test("a loader next to its page is fine", () => {
    expect(detectLoaderConflicts(appDir)).toEqual([]);
  });

  test("flags a loader without a sibling page", () => {
    file("orphan/loader.js", "export default () => 1");
    const conflicts = detectLoaderConflicts(appDir);
    rmSync(join(appDir, "orphan"), { recursive: true, force: true });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].route).toBe("/orphan");
    expect(conflicts[0].reason).toContain("no sibling page");
  });

  test("flags a loader placed next to a route.* endpoint", () => {
    file("api/hello/loader.js", "export default () => 1");
    const conflicts = detectLoaderConflicts(appDir);
    rmSync(join(appDir, "api/hello/loader.js"), { force: true });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].reason).toContain("route.*");
  });
});

describe("generated entry sources", () => {
  test("loaderEntrySource imports every loader and builds the registry", () => {
    const src = loaderEntrySource(["/a/app/todos/loader.js", "/a/app/x/loader.ts"], "/a/app", {
      locales: ["en", "fr"],
      defaultLocale: "en",
    });
    expect(src).toContain(`import { createLoaderRegistry } from "@opentf/web/server";`);
    expect(src).toContain(`import * as l0 from "/a/app/todos/loader.js";`);
    expect(src).toContain(`["/a/app/x/loader.ts"]: l1,`);
    expect(src).toContain(`appDir: "/a/app"`);
    expect(src).toContain(`"defaultLocale":"en"`);
    expect(src).toContain(`export const loaders = createLoaderRegistry(`);
  });

  test("entrySource emits mountApp({ loaders }) only when routes exist", () => {
    const pages = ["/a/app/page.jsx"];
    expect(entrySource(pages, "/a/app", undefined, null, null, ["/todos", "/items/[id]"])).toContain(
      `loaders: ["/todos","/items/[id]"],`,
    );
    expect(entrySource(pages, "/a/app")).not.toContain("loaders:");
  });
});

describe("injectRouteData", () => {
  const SHELL = `<html><body><div id="app"></div></body></html>`;

  test("injects the payload script before </body>", () => {
    const out = injectRouteData(SHELL, `{"items":["a"]}`);
    expect(out).toContain(`<script type="application/json" id="__otfw_data">{"items":["a"]}</script>`);
    expect(out.indexOf("__otfw_data")).toBeLessThan(out.indexOf("</body>"));
  });

  test("no-op for an empty payload", () => {
    expect(injectRouteData(SHELL, "")).toBe(SHELL);
  });

  test("keeps `$` sequences literal", () => {
    const out = injectRouteData(SHELL, `{"price":"$189.00"}`);
    expect(out).toContain(`"$189.00"`);
  });
});
