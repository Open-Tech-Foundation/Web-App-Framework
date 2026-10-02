import { expect, test } from "runtime:test";
import { join } from "runtime:path";
import { discard, tempDir, writeTree } from "../../web-cli/tests/fixture.js";
import { docsNavPlugin } from "../build/docs-nav-plugin.js";

async function navigation(files, options = {}) {
  const dir = await tempDir("docs-nav");
  try {
    await writeTree(dir, files);
    const plugin = docsNavPlugin({ appDir: join(dir, "app"), ...options });
    const resolved = plugin.resolve.handler("@opentf/web-docs/nav");
    const result = await plugin.load.handler(resolved.id);
    return { tree: JSON.parse(result.code.slice("export default ".length).trim().replace(/;$/, "")), watched: result.dependsOn };
  } finally { await discard(dir); }
}

const page = (title) => `---\ntitle: ${title}\n---\n# ${title}`;

test("automatic navigation omits dynamic branches and retains ordered static pages", async () => {
  const { tree, watched } = await navigation({
    "app/docs/page.mdx": page("Docs"),
    "app/docs/_meta.json": JSON.stringify({ index: "Introduction", topic: "Topics", "[slug]": "Generated", guide: "Start here" }),
    "app/docs/topic/page.mdx": page("Topic"),
    "app/docs/topic/_meta.json": JSON.stringify({ "[slug]": "Dynamic topic", overview: "Overview" }),
    "app/docs/topic/[slug]/page.jsx": 'throw Error("A navigation scan must not evaluate page generators");',
    "app/docs/topic/[slug]/details/page.mdx": page("Dynamic details"),
    "app/docs/topic/overview/page.mdx": page("Overview"),
    "app/docs/[slug]/page.mdx": page("Dynamic docs"),
    "app/docs/guide/page.mdx": page("Guide"),
  });
  expect(tree).toEqual({ "/docs": [
    { title: "Introduction", path: "/docs" },
    { title: "Topics", path: "/docs/topic", items: [{ title: "Overview", path: "/docs/topic/overview" }] },
    { title: "Start here", path: "/docs/guide" },
  ] });
  expect(watched.some(path => path.includes("[slug]"))).toBe(false);
  expect(watched.some(path => path.endsWith("topic/_meta.json"))).toBe(true);
});

test("dynamic top-level sections and catch-all branches never appear in navigation", async () => {
  const { tree } = await navigation({
    "app/[locale]/docs/page.mdx": page("Localized docs"),
    "app/[...path]/page.mdx": page("Catch-all section"),
    "app/docs/page.mdx": page("Docs"),
    "app/docs/[...path]/page.jsx": "export default function Page() {}",
    "app/docs/reference/[version]/api/page.mdx": page("Versioned API"),
    "app/docs/reference/stable/page.mdx": page("Stable API"),
  });
  expect(tree).toEqual({ "/docs": [
    { title: "Docs", path: "/docs" },
    { title: "Reference", items: [{ title: "Stable API", path: "/docs/reference/stable" }] },
  ] });
});

test("dynamic-only groups disappear while their static landing pages and exclusions remain valid", async () => {
  const { tree } = await navigation({
    "app/docs/generated/[id]/page.tsx": "export default function Page() {}",
    "app/docs/topic/page.md": page("Topic landing"),
    "app/docs/topic/[id]/page.mdx": page("Generated topic"),
    "app/docs/.draft/page.mdx": page("Draft"),
    "app/docs/_private/page.mdx": page("Private"),
    "app/docs/excluded/page.mdx": page("Excluded"),
    "app/excluded/page.mdx": page("Excluded section"),
  }, { exclude: new Set(["excluded"]) });
  expect(tree).toEqual({ "/docs": [{ title: "Topic landing", path: "/docs/topic" }] });
});
