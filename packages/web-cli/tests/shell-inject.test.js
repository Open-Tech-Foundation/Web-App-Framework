// Unit tests for the SSR/SSG shell-injection + server-entry helpers shared by
// `runPrerender` (SSG) and `runServe` (SSR). These are pure string functions — the
// glue that turns a render result into a full HTML document.

import { describe, expect, test } from "bun:test";

import {
  entrySource,
  injectHead,
  injectMarkup,
  modulepreloadTags,
  routeChunkManifest,
  serverEntrySource,
  stampHydrateSentinel,
  withHtmlLang,
} from "../src/shared.js";

const SHELL =
  `<!doctype html><html><head>\n<title>Default</title>\n</head>` +
  `<body><div id="app"></div></body></html>`;

describe("injectMarkup", () => {
  test("fills the empty #app container with rendered markup", () => {
    const out = injectMarkup(SHELL, "<h1>Hi</h1>");
    expect(out).toContain(`<div id="app"><h1>Hi</h1></div>`);
  });

  test("matches an #app with extra attributes and inner whitespace", () => {
    const shell = `<body><div id="app" class="root">\n  </div></body>`;
    expect(injectMarkup(shell, "<p>x</p>")).toContain(`<div id="app" class="root"><p>x</p></div>`);
  });

  test("leaves the shell untouched when there is no #app", () => {
    const shell = `<body><main></main></body>`;
    expect(injectMarkup(shell, "<p>x</p>")).toBe(shell);
  });

  test("keeps `$` sequences literal (e.g. a formatted price, not a back-reference)", () => {
    // "$189.00" contains "$1" — a string replacement would expand it to capture group 1.
    const out = injectMarkup(SHELL, `<p class="price">$189.00</p>`);
    expect(out).toContain(`<div id="app"><p class="price">$189.00</p></div>`);
    // And the i18n French form with a trailing "$US".
    expect(injectMarkup(SHELL, `<p>189,00 $US</p>`)).toContain(`<p>189,00 $US</p>`);
  });
});

describe("injectHead", () => {
  test("inserts head tags before </head>", () => {
    const out = injectHead(SHELL, `<meta name="description" content="d">`);
    expect(out).toContain(`<meta name="description" content="d">\n</head>`);
  });

  test("drops the shell's default <title> when the route supplies its own", () => {
    const out = injectHead(SHELL, "<title>Route</title>");
    expect(out).toContain("<title>Route</title>");
    expect(out).not.toContain("<title>Default</title>");
  });

  test("keeps the shell's <title> when the route head has none", () => {
    const out = injectHead(SHELL, `<link rel="canonical" href="/x">`);
    expect(out).toContain("<title>Default</title>");
    expect(out).toContain(`<link rel="canonical" href="/x">`);
  });

  test("returns the shell unchanged for empty head", () => {
    expect(injectHead(SHELL, "")).toBe(SHELL);
  });

  test("keeps `$` literal in head content (e.g. a price in a meta description)", () => {
    const out = injectHead(SHELL, `<meta name="description" content="from $189.00">`);
    expect(out).toContain(`content="from $189.00">`);
  });
});

describe("withHtmlLang (i18n)", () => {
  test("replaces an existing <html lang>", () => {
    expect(withHtmlLang(`<html lang="en"><body></body></html>`, "fr")).toContain(`<html lang="fr">`);
  });

  test("adds lang when the shell has none", () => {
    expect(withHtmlLang(`<html><body></body></html>`, "ja")).toContain(`<html lang="ja">`);
  });

  test("is a no-op without a locale", () => {
    const shell = `<html lang="en"></html>`;
    expect(withHtmlLang(shell, null)).toBe(shell);
  });
});

describe("stampHydrateSentinel", () => {
  test("adds the data-otfw-hydrate sentinel to #app", () => {
    expect(stampHydrateSentinel(SHELL)).toContain(`<div id="app" data-otfw-hydrate>`);
  });

  test("preserves existing #app attributes", () => {
    const shell = `<body><div id="app" class="root"></div></body>`;
    expect(stampHydrateSentinel(shell)).toContain(`<div id="app" class="root" data-otfw-hydrate>`);
  });

  test("is idempotent — never double-stamps", () => {
    const once = stampHydrateSentinel(SHELL);
    expect(stampHydrateSentinel(once)).toBe(once);
  });

  test("leaves a shell without #app untouched", () => {
    const shell = `<body><main></main></body>`;
    expect(stampHydrateSentinel(shell)).toBe(shell);
  });

  test("the stamped #app still accepts injected markup", () => {
    const stamped = stampHydrateSentinel(SHELL);
    expect(injectMarkup(stamped, "<h1>Hi</h1>")).toContain(
      `<div id="app" data-otfw-hydrate><h1>Hi</h1></div>`,
    );
  });
});

describe("serverEntrySource", () => {
  test("eager-imports every page, registers the route map, and re-exports the render API", () => {
    const src = serverEntrySource(["/app/page.jsx", "/app/about/page.jsx"]);
    expect(src).toContain(`import * as p0 from "/app/page.jsx";`);
    expect(src).toContain(`import * as p1 from "/app/about/page.jsx";`);
    expect(src).toContain(`["/app/page.jsx"]: p0,`);
    expect(src).toContain(`["/app/about/page.jsx"]: p1,`);
    expect(src).toContain(`import { registerRoutes } from "@opentf/web";`);
    expect(src).toContain(`renderRoute, renderHead, collectRoutePaths`);
    // resolveMetadata is re-exported so the CSR build can resolve the root layout's
    // route-independent head via resolveLayoutShellHead.
    expect(src).toContain(`resolveMetadata`);
  });

  test("configures the server-side router with i18n so prefixes match", () => {
    const src = serverEntrySource(["/app/page.jsx"], { locales: ["en", "fr"], defaultLocale: "en" });
    expect(src).toContain(`import { registerRoutes, configureI18n } from "@opentf/web";`);
    expect(src).toContain(`configureI18n({"locales":["en","fr"],"defaultLocale":"en"});`);
  });

  test("omits configureI18n when i18n is absent", () => {
    const src = serverEntrySource(["/app/page.jsx"]);
    expect(src).not.toContain("configureI18n");
  });
});

describe("entrySource route-map keys", () => {
  const pages = ["/opt/buildhome/repo/website/app/page.jsx", "/opt/buildhome/repo/website/app/docs/page.jsx"];
  const appDir = "/opt/buildhome/repo/website/app";

  test("keys are app-relative — the build machine's path never ships", () => {
    const src = entrySource(pages, appDir);
    expect(src).toContain(`["/app/page.jsx"]: () => import(`);
    expect(src).toContain(`["/app/docs/page.jsx"]: () => import(`);
    expect(src).not.toContain(`["/opt/buildhome`);
  });

  test("the import specifier stays absolute so the bundler can resolve it", () => {
    const src = entrySource(pages, appDir);
    expect(src).toContain(`import("/opt/buildhome/repo/website/app/page.jsx")`);
  });

  test("a custom loaderUrl (dev server) still gets the real file path", () => {
    const src = entrySource(pages, appDir, (p) => `/__route${p.replace(appDir, "")}`);
    expect(src).toContain(`["/app/docs/page.jsx"]: () => import("/__route/docs/page.jsx")`);
  });
});

describe("routeChunkManifest", () => {
  // A miniature Rolldown output: the entry statically pulls in `shared`, each route is
  // its own dynamically-imported chunk, and /docs' page shares a `md` chunk with nobody.
  const chunk = (fileName, moduleIds, imports = []) => ({
    type: "chunk",
    fileName,
    facadeModuleId: moduleIds[0],
    moduleIds,
    imports,
  });
  const appDir = "/r/app";
  const pages = [
    "/r/app/layout.jsx",
    "/r/app/page.jsx",
    "/r/app/docs/layout.jsx",
    "/r/app/docs/[slug]/page.jsx",
    "/r/app/404.jsx",
  ];
  const output = [
    chunk("bundle-A.js", ["/r/.otfw/entry.js"], ["shared-S.js"]),
    chunk("shared-S.js", ["/r/shared.js"]),
    chunk("layout-L.js", ["/r/app/layout.jsx"], ["shared-S.js"]),
    chunk("page-H.js", ["/r/app/page.jsx"]),
    chunk("layout-D.js", ["/r/app/docs/layout.jsx"]),
    chunk("page-S.js", ["/r/app/docs/[slug]/page.jsx"], ["md-M.js"]),
    chunk("md-M.js", ["/r/markdown.js"]),
    chunk("404-N.js", ["/r/app/404.jsx"]),
    { type: "asset", fileName: "style-C.css" },
  ];
  const manifest = routeChunkManifest({ output, pages, appDir, entryFileName: "bundle-A.js" });

  test("a nested route lists its page chunk plus every layout in its chain", () => {
    // Page (and what it statically imports) first, then the layout chain outermost-in —
    // the same order `layoutChain` yields at runtime.
    expect(manifest.routes["/docs/[slug]"]).toEqual([
      "/assets/page-S.js",
      "/assets/md-M.js",
      "/assets/layout-L.js",
      "/assets/layout-D.js",
    ]);
  });

  test("chunks the entry already imports statically are left out (bundle.js brings them)", () => {
    // The root layout imports shared-S.js, but so does the entry — no point preloading it.
    expect(manifest.routes["/"]).toEqual(["/assets/page-H.js", "/assets/layout-L.js"]);
  });

  test("the 404 carries no layout chain, matching layoutChain(null) at runtime", () => {
    expect(manifest.notFound).toEqual(["/assets/404-N.js"]);
  });

  test("every page route is keyed by its pattern, layouts are not routes", () => {
    expect(Object.keys(manifest.routes).sort()).toEqual(["/", "/docs/[slug]"]);
  });
});

describe("modulepreloadTags", () => {
  test("renders one link per chunk", () => {
    expect(modulepreloadTags(["/assets/a.js", "/assets/b.js"])).toBe(
      `<link rel="modulepreload" href="/assets/a.js">\n<link rel="modulepreload" href="/assets/b.js">`,
    );
  });

  test("empty/missing input renders nothing (so callers can append unconditionally)", () => {
    expect(modulepreloadTags([])).toBe("");
    expect(modulepreloadTags(undefined)).toBe("");
  });
});

describe("entrySource (i18n)", () => {
  test("threads the i18n config into mountApp", () => {
    const src = entrySource(["/app/page.jsx"], "/app", undefined, {
      locales: ["en", "fr"],
      defaultLocale: "en",
    });
    expect(src).toContain(`i18n: {"locales":["en","fr"],"defaultLocale":"en"}`);
  });

  test("omits the i18n option when not configured", () => {
    expect(entrySource(["/app/page.jsx"], "/app")).not.toContain("i18n:");
  });
});
