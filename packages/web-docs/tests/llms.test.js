import { afterEach, describe, expect, test } from "../../web-cli/tests/harness.js";
import { makeTempDir, remove } from "runtime:fs";
import { join } from "runtime:path";

import { writeFile } from "../../web-cli/tests/fixture.js";
import { renderLlmsFullTxt, renderLlmsTxt } from "../build/llms.js";

const roots = [];

async function fixture() {
  const root = await makeTempDir({ prefix: "otfw-llms-" });
  const appDir = join(root, "app");
  await writeFile(
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
  await writeFile(
    join(appDir, "blog", "hello", "page.mdx"),
    ["---", "title: Hello", "description: Launch notes.", "---", "", "# Hello", "", "Post body."].join("\n"),
  );
  await writeFile(join(appDir, "docs", "[slug]", "page.mdx"), "# Dynamic");
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

afterEach(async () => {
  for (const root of roots.splice(0)) await remove(root, { recursive: true });
});

describe("renderLlmsTxt", () => {
  test("renders grouped absolute route links and excludes dynamic routes", async () => {
    const { appDir, pages } = await fixture();
    const txt = await renderLlmsTxt({
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

  test("summarizes the site with its own description, not a fixed blurb", async () => {
    const { appDir, pages } = await fixture();
    const txt = await renderLlmsTxt({
      appDir,
      pages,
      baseUrl: "https://example.com",
      config: { docs: { title: "Example" } },
      siteDescription: "Everything about Example.",
    });

    expect(txt).toContain("> Everything about Example.");
    expect(txt).not.toContain("OTF Web framework");
  });

  test("prefers an explicit docs.description over the resolved site description", async () => {
    const { appDir, pages } = await fixture();
    const txt = await renderLlmsTxt({
      appDir,
      pages,
      baseUrl: "https://example.com",
      config: { docs: { title: "Example", description: "Configured summary." } },
      siteDescription: "Everything about Example.",
    });

    expect(txt).toContain("> Configured summary.");
  });

  test("falls back to the home page description, then to the site title", async () => {
    const { appDir, pages } = await fixture();
    const home = join(appDir, "page.mdx");
    await writeFile(home, ["---", "title: Home", "description: The Example project.", "---", "", "# Home"].join("\n"));

    expect(
      await renderLlmsTxt({ appDir, pages: [...pages, home], baseUrl: "https://example.com", config: { docs: { title: "Example" } } }),
    ).toContain("> The Example project.");
    expect(
      await renderLlmsTxt({ appDir, pages, baseUrl: "https://example.com", config: { docs: { title: "Example" } } }),
    ).toContain("> Documentation for Example.");
  });
});

describe("renderLlmsFullTxt", () => {
  test("renders cleaned Markdown content for filesystem routes", async () => {
    const { appDir, pages } = await fixture();
    const txt = await renderLlmsFullTxt({
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
