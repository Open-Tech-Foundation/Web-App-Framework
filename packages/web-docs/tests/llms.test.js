import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderLlmsFullTxt, renderLlmsTxt } from "../build/llms.js";

const roots = [];

function fixture() {
  const root = join(tmpdir(), `otfw-llms-${Date.now()}-${roots.length}`);
  const appDir = join(root, "app");
  mkdirSync(join(appDir, "docs", "guide"), { recursive: true });
  mkdirSync(join(appDir, "blog", "hello"), { recursive: true });
  mkdirSync(join(appDir, "docs", "[slug]"), { recursive: true });
  writeFileSync(
    join(appDir, "docs", "guide", "page.mdx"),
    [
      "---",
      "title: Guide",
      "description: Learn the basics.",
      "---",
      "",
      "import { Callout } from '@opentf/web-docs';",
      "",
      "# Guide",
      "",
      "Use OTF Web.",
    ].join("\n"),
  );
  writeFileSync(
    join(appDir, "blog", "hello", "page.mdx"),
    ["---", "title: Hello", "description: Launch notes.", "---", "", "# Hello", "", "Post body."].join("\n"),
  );
  writeFileSync(join(appDir, "docs", "[slug]", "page.mdx"), "# Dynamic");
  roots.push(root);
  return {
    appDir,
    pages: [
      join(appDir, "docs", "guide", "page.mdx"),
      join(appDir, "blog", "hello", "page.mdx"),
      join(appDir, "docs", "[slug]", "page.mdx"),
    ],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("renderLlmsTxt", () => {
  test("renders grouped absolute route links and excludes dynamic routes", () => {
    const { appDir, pages } = fixture();
    const txt = renderLlmsTxt({
      appDir,
      pages,
      baseUrl: "https://example.com",
      config: { docs: { title: "Example" }, blog: { dir: "blog" } },
    });

    expect(txt).toContain("# Example");
    expect(txt).toContain("## Documentation");
    expect(txt).toContain("- [Guide](https://example.com/docs/guide): Learn the basics.");
    expect(txt).toContain("## Blog");
    expect(txt).toContain("- [Hello](https://example.com/blog/hello): Launch notes.");
    expect(txt).toContain("[llms-full.txt](https://example.com/llms-full.txt)");
    expect(txt).not.toContain("[slug]");
  });

  test("summarizes the site with its own description, not a fixed blurb", () => {
    const { appDir, pages } = fixture();
    const txt = renderLlmsTxt({
      appDir,
      pages,
      baseUrl: "https://example.com",
      config: { docs: { title: "Example" } },
      siteDescription: "Everything about Example.",
    });

    expect(txt).toContain("> Everything about Example.");
    expect(txt).not.toContain("OTF Web framework");
  });

  test("prefers an explicit docs.description over the resolved site description", () => {
    const { appDir, pages } = fixture();
    const txt = renderLlmsTxt({
      appDir,
      pages,
      baseUrl: "https://example.com",
      config: { docs: { title: "Example", description: "Configured summary." } },
      siteDescription: "Everything about Example.",
    });

    expect(txt).toContain("> Configured summary.");
  });

  test("falls back to the home page description, then to the site title", () => {
    const { appDir, pages } = fixture();
    writeFileSync(
      join(appDir, "page.mdx"),
      ["---", "title: Home", "description: The Example project.", "---", "", "# Home"].join("\n"),
    );
    const home = join(appDir, "page.mdx");

    expect(
      renderLlmsTxt({ appDir, pages: [...pages, home], baseUrl: "https://example.com", config: { docs: { title: "Example" } } }),
    ).toContain("> The Example project.");

    expect(
      renderLlmsTxt({ appDir, pages, baseUrl: "https://example.com", config: { docs: { title: "Example" } } }),
    ).toContain("> Documentation for Example.");
  });
});

describe("renderLlmsFullTxt", () => {
  test("renders cleaned Markdown content for filesystem routes", () => {
    const { appDir, pages } = fixture();
    const txt = renderLlmsFullTxt({
      appDir,
      pages,
      baseUrl: "https://example.com",
      config: { docs: { title: "Example" } },
    });

    expect(txt).toContain("# Example Full Documentation");
    expect(txt).toContain("URL: https://example.com/docs/guide");
    expect(txt).toContain("Description: Learn the basics.");
    expect(txt).toContain("# Guide");
    expect(txt).toContain("Use OTF Web.");
    expect(txt).not.toContain("import { Callout }");
    expect(txt).not.toContain("---");
  });
});
