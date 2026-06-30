// Unit tests for the SSR/SSG shell-injection + server-entry helpers shared by
// `runPrerender` (SSG) and `runServe` (SSR). These are pure string functions — the
// glue that turns a render result into a full HTML document.

import { describe, expect, test } from "bun:test";

import {
  injectHead,
  injectMarkup,
  serverEntrySource,
  stampHydrateSentinel,
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
  });
});
