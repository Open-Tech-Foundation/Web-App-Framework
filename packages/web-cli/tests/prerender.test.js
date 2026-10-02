import { expect, test } from "runtime:test";
import { file } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { discard, tempDir, writeTree } from "./fixture.js";
import { runPrerender } from "../src/prerender.js";

const root = dirname(dirname(dirname(dirname(fromFileURL(import.meta.url)))));

test("encoded static URLs write decoded HTML and loader files while retaining encoded canonical URLs", async () => {
  const dir = await tempDir("encoded-prerender");
  try {
    await writeTree(dir, {
      "package.json": '{"type":"module"}',
      "app/post/[slug]/page.jsx": `
export function getStaticPaths() { return [{ params: { slug: "hello world" } }, { params: { slug: "100%25" } }]; }
export function generateMetadata({ params }) { return { title: params.slug }; }
export default function Post({ params }) { return <h1>{params.slug}</h1>; }
`,
    });
    const outDir = join(dir, "dist");
    const result = await runPrerender({
      root: dir,
      pages: [join(dir, "app/post/[slug]/page.jsx")],
      webEntry: join(root, "packages/web/index.js"),
      otfwc: join(root, "target/debug/otfwc"),
      shellHtml: '<html><head></head><body><div id="app"></div></body></html>',
      outDir, baseUrl: "https://example.com",
      loaders: {
        match(path) { return { path }; },
        async loadSerialized({ path }) { return { data: { path }, json: JSON.stringify({ path }) }; },
      },
    });
    expect(result.failed).toEqual([]);
    expect(result.count).toBe(2);
    const html = await file(join(outDir, "post/hello world/index.html")).text();
    expect(html).toContain('href="https://example.com/post/hello%20world"');
    expect(html).toContain('<title data-otfw-head="">hello world</title>');
    expect(await file(join(outDir, "post/hello world/__data.json")).json()).toEqual({ path: "/post/hello%20world" });
    expect(await file(join(outDir, "post/100%25/__data.json")).json()).toEqual({ path: "/post/100%2525" });
  } finally { await discard(dir); }
});
