import { exists, file, remove, write } from "runtime:fs";
import { join } from "runtime:path";

const BLOG_CONFIG = `
  // Sample blog — demo post under app/blog/. Remove this block and app/blog/ if unused.
  blog: {
    dir: "blog",
    lastUpdated: true,
  },`;

const BLOG_NAV = `nav: [
      { label: "Docs", href: "/docs" },
      { label: "Blog", href: "/blog" },
    ],`;

const BLOG_DOCS_SECTION = `
## Blog (demo)

This starter includes a **demo blog** under \`app/blog/\` — one sample post plus a
\`/blog\` link in the top navbar. Replace the placeholder post with your own MDX, or
remove \`app/blog/\`, the \`blog\` block in \`otfw.config.js\`, and the Blog nav entry
if you only need docs.
`;

/**
 * Enable or strip the optional blog demo in a scaffolded docs project.
 *
 * @param {string} targetDir
 * @param {boolean} enabled
 */
export async function applyDocsBlog(targetDir, enabled) {
  const blogDir = join(targetDir, "app/blog");
  const configPath = join(targetDir, "otfw.config.js");
  const docsPagePath = join(targetDir, "app/docs/page.mdx");

  if (!enabled) {
    if (await exists(blogDir)) await remove(blogDir, { recursive: true });
    return;
  }

  let config = await file(configPath).text();
  if (!config.includes('href: "/blog"')) {
    config = config.replace(
      'nav: [{ label: "Docs", href: "/docs" }],',
      BLOG_NAV,
    );
  }
  if (!config.includes("blog:")) {
    config = config.replace(/\n}\);\s*$/, `${BLOG_CONFIG}\n});\n`);
  }
  await write(configPath, config);

  let page = await file(docsPagePath).text();
  if (!page.includes("## Blog (demo)")) {
    page = page.replace("\n## Edit Content\n", `${BLOG_DOCS_SECTION}\n## Edit Content\n`);
    await write(docsPagePath, page);
  }
}
