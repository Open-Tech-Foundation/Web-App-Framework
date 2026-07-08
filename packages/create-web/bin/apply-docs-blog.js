import fs from "node:fs";
import path from "node:path";

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
export function applyDocsBlog(targetDir, enabled) {
  const blogDir = path.join(targetDir, "app/blog");
  const configPath = path.join(targetDir, "otfw.config.js");
  const docsPagePath = path.join(targetDir, "app/docs/page.mdx");

  if (!enabled) {
    if (fs.existsSync(blogDir)) fs.rmSync(blogDir, { recursive: true, force: true });
    return;
  }

  let config = fs.readFileSync(configPath, "utf-8");
  if (!config.includes('href: "/blog"')) {
    config = config.replace(
      'nav: [{ label: "Docs", href: "/docs" }],',
      BLOG_NAV,
    );
  }
  if (!config.includes("blog:")) {
    config = config.replace(/\n}\);\s*$/, `${BLOG_CONFIG}\n});\n`);
  }
  fs.writeFileSync(configPath, config);

  let page = fs.readFileSync(docsPagePath, "utf-8");
  if (!page.includes("## Blog (demo)")) {
    page = page.replace("\n## Edit Content\n", `${BLOG_DOCS_SECTION}\n## Edit Content\n`);
    fs.writeFileSync(docsPagePath, page);
  }
}