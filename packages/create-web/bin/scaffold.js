import { copy, exists, file, mkdir, readDir, stat, write } from "runtime:fs";
import { basename, dirname, fromFileURL, join, resolve } from "runtime:path";
import { applyDocsBlog } from "./apply-docs-blog.js";
import { applyTypescript } from "./apply-typescript.js";
import { pinOpentfDeps } from "./resolve-deps.js";

const __dirname = dirname(fromFileURL(import.meta.url));
const defaultTemplatesRoot = resolve(__dirname, "../templates");

async function copyEntry(src, dest) {
  if ((await stat(src)).isDir) await copyDir(src, dest);
  else await copy(src, dest);
}

async function copyDir(srcDir, destDir) {
  await mkdir(destDir, { recursive: true });
  for (const entry of await readDir(srcDir)) {
    await copyEntry(join(srcDir, entry.name), join(destDir, entry.name));
  }
}

/**
 * Copy a template into `targetDir`, pin `@opentf/*` deps from npm, and apply options.
 * Dependency resolution runs before any files are written so npm failures are atomic.
 *
 * @param {{
 *   template: "spa" | "fullstack" | "docs" | "library",
 *   targetDir: string,
 *   styling?: "none" | "tailwind",
 *   blog?: boolean,
 *   typescript?: boolean,
 *   templatesRoot?: string,
 *   onResolved?: (name: string, version: string) => void,
 * }} opts
 */
export async function scaffold({
  template,
  targetDir,
  styling = "none",
  blog = false,
  typescript = false,
  templatesRoot = defaultTemplatesRoot,
  onResolved,
}) {
  const templateDir = join(templatesRoot, template);
  if (!(await exists(templateDir))) {
    throw new Error(`Unknown template: ${template}`);
  }

  const templatePkgPath = join(templateDir, "package.json");
  const pkg = JSON.parse(await file(templatePkgPath).text());
  pkg.name = basename(targetDir);
  await pinOpentfDeps(pkg, { onResolved });

  if (typescript) {
    pkg.devDependencies = { ...pkg.devDependencies, typescript: "^5.8.0" };
  }

  await mkdir(targetDir, { recursive: true });

  for (const entry of await readDir(templateDir)) {
    const src = join(templateDir, entry.name);
    const dest = join(targetDir, entry.name === "_gitignore" ? ".gitignore" : entry.name);
    if (entry.name === "package.json") {
      await write(dest, JSON.stringify(pkg, null, 2) + "\n");
    } else {
      await copyEntry(src, dest);
    }
  }

  if (styling === "tailwind") {
    const cssPath = join(targetDir, "app", "global.css");
    const css = await file(cssPath).text();
    await write(cssPath, `@import "tailwindcss";\n\n${css}`);
  }

  if (template === "docs") {
    await applyDocsBlog(targetDir, blog);
  }

  if (typescript) {
    await applyTypescript(targetDir, template, pkg);
    await write(
      join(targetDir, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
  }

  return { packageJson: pkg };
}
