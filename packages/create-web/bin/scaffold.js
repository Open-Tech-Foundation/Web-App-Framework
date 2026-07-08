import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyTypescript } from "./apply-typescript.js";
import { pinOpentfDeps } from "./resolve-deps.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultTemplatesRoot = path.resolve(__dirname, "../templates");

function copy(src, dest) {
  if (fs.statSync(src).isDirectory()) copyDir(src, dest);
  else fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    copy(path.resolve(srcDir, file), path.resolve(destDir, file));
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
 *   typescript?: boolean,
 *   templatesRoot?: string,
 *   onResolved?: (name: string, version: string) => void,
 * }} opts
 */
export async function scaffold({
  template,
  targetDir,
  styling = "none",
  typescript = false,
  templatesRoot = defaultTemplatesRoot,
  onResolved,
}) {
  const templateDir = path.join(templatesRoot, template);
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Unknown template: ${template}`);
  }

  const templatePkgPath = path.join(templateDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(templatePkgPath, "utf-8"));
  pkg.name = path.basename(targetDir);
  await pinOpentfDeps(pkg, { onResolved });

  if (typescript) {
    pkg.devDependencies = { ...pkg.devDependencies, typescript: "^5.8.0" };
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of fs.readdirSync(templateDir)) {
    const src = path.join(templateDir, file);
    const dest = path.join(targetDir, file === "_gitignore" ? ".gitignore" : file);
    if (file === "package.json") {
      fs.writeFileSync(dest, JSON.stringify(pkg, null, 2) + "\n");
    } else {
      copy(src, dest);
    }
  }

  if (styling === "tailwind") {
    const cssPath = path.join(targetDir, "app", "global.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    fs.writeFileSync(cssPath, `@import "tailwindcss";\n\n${css}`);
  }

  if (typescript) {
    applyTypescript(targetDir, template, pkg);
    fs.writeFileSync(
      path.join(targetDir, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
  }

  return { packageJson: pkg };
}