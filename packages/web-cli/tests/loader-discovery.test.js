// Unit tests for the route-loader toolchain plumbing (docs/DATA.md): discovery of
// `loader.{js,ts}` files, route derivation, misplacement detection, the generated
// entry sources, and the `#__otfw_data` shell injection.

import { join } from "runtime:path";

import { discard, tempDir, writeFile } from "./fixture.js";
import { afterAll, beforeAll, describe, expect, test } from "./harness.js";

import {
  detectLoaderConflicts,
  discoverLoaders,
  entrySource,
  injectRouteData,
  loaderEntrySource,
  loaderRoutePath,
} from "../src/shared.js";

let root;
let appDir;

const file = (rel, content = "") => writeFile(join(appDir, rel), content);

beforeAll(async () => {
  root = await tempDir("otfw-loader-discovery");
  appDir = join(root, "app");
  // A well-formed app: pages with loaders (static + dynamic), a loader-less page,
  // an API route, and files that must NOT be discovered as loaders.
  await file("page.jsx", "export default () => {}");
  await file("todos/page.jsx", "export default () => {}");
  await file("todos/loader.js", "export default () => []");
  await file("items/[id]/page.tsx", "export default () => {}");
  await file("items/[id]/loader.ts", "export default () => null");
  await file("about/page.jsx", "export default () => {}");
  await file("api/hello/route.js", "export const GET = () => Response.json(1)");
  await file("todos/loader.jsx", "not a loader (x-variants are JSX, loaders are plain js/ts)");
  await file("todos/notloader.js", "");
});

afterAll(() => discard(root));

describe("discoverLoaders + loaderRoutePath", () => {
  test("finds loader.{js,ts} anywhere under app/, nothing else", async () => {
    const found = (await discoverLoaders(appDir)).map((f) => loaderRoutePath(f, appDir));
    expect(found.sort()).toEqual(["/items/[id]", "/todos"]);
  });

  test("respects the exclude set", async () => {
    const only = await discoverLoaders(appDir, new Set(["todos"]));
    expect(only.map((f) => loaderRoutePath(f, appDir))).toEqual(["/items/[id]"]);
  });

  test("a root loader maps to /", () => {
    expect(loaderRoutePath(join(appDir, "loader.js"), appDir)).toBe("/");
  });
});

describe("detectLoaderConflicts", () => {
  test("a loader next to its page is fine", async () => {
    expect(await detectLoaderConflicts(appDir)).toEqual([]);
  });

  test("flags a loader without a sibling page", async () => {
    await file("orphan/loader.js", "export default () => 1");
    const conflicts = await detectLoaderConflicts(appDir);
    await discard(join(appDir, "orphan"));
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].route).toBe("/orphan");
    expect(conflicts[0].reason).toContain("no sibling page");
  });

  test("flags a loader placed next to a route.* endpoint", async () => {
    await file("api/hello/loader.js", "export default () => 1");
    const conflicts = await detectLoaderConflicts(appDir);
    await discard(join(appDir, "api/hello/loader.js"));
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

  test("entrySource emits mountApp({ loaders }) only when routes exist", async () => {
    const pages = ["/a/app/page.jsx"];
    const withLoaders = await entrySource(pages, "/a/app", undefined, null, null, [
      "/todos",
      "/items/[id]",
    ]);
    expect(withLoaders).toContain(`loaders: ["/todos","/items/[id]"],`);
    expect(await entrySource(pages, "/a/app")).not.toContain("loaders:");
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
