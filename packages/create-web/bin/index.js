#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prompts from "prompts";
import { cyan, green, red, reset, yellow, bold } from "kolorist";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const orange = (str) => `\x1b[38;2;255;165;0m${str}${reset("")}`;

async function init() {
  console.log(`\n  ${bold(orange("Open Tech Foundation"))}`);
  console.log(`\n  ${bold(cyan("OTF Web"))} ${yellow("Scaffolding Tool")} ✨\n`);

  let targetDir = process.argv[2];
  const defaultProjectName = targetDir || "web-app";
  let result = {};

  try {
    result = await prompts(
      [
        {
          type: targetDir ? null : "text",
          name: "projectName",
          message: reset("Project name:"),
          initial: defaultProjectName,
          onState: (state) => {
            targetDir = state.value.trim() || defaultProjectName;
          },
        },
        {
          type: () =>
            fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 ? "confirm" : null,
          name: "overwrite",
          message: () =>
            (targetDir === "." ? "Current directory" : `Target directory "${targetDir}"`) +
            ` is not empty. Remove existing files and continue?`,
        },
        {
          type: (_, { overwrite } = {}) => {
            if (overwrite === false) throw new Error(red("✖") + " Operation cancelled");
            return null;
          },
          name: "overwriteChecker",
        },
        {
          type: "select",
          name: "template",
          message: reset("Project type:"),
          initial: 0,
          choices: [
            { title: reset("App"), value: "bare", description: "A minimal SPA starter" },
            {
              title: cyan("Documentation site"),
              value: "docs",
              description: "A one-page MDX docs starter powered by @opentf/web-docs",
            },
          ],
        },
        {
          // Styling choice applies to the App template; the docs template ships its
          // own themed stylesheet.
          type: (_, { template } = {}) => (template === "docs" ? null : "select"),
          name: "styling",
          message: reset("Select a styling solution:"),
          initial: 1,
          choices: [
            { title: reset("Plain CSS"), value: "none", description: "A small starter stylesheet" },
            {
              title: cyan("TailwindCSS"),
              value: "tailwind",
              description: "Tailwind v4, compiled by the toolchain",
            },
          ],
        },
      ],
      {
        onCancel: () => {
          throw new Error(red("✖") + " Operation cancelled");
        },
      },
    );
  } catch (cancelled) {
    console.log(cancelled.message);
    return;
  }

  const { styling, overwrite, template = "bare" } = result;
  const root = path.join(process.cwd(), targetDir);

  if (overwrite) emptyDir(root);
  else if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

  const templateDir = path.resolve(__dirname, `../templates/${template}`);
  for (const file of fs.readdirSync(templateDir)) {
    const src = path.join(templateDir, file);
    // Templates ship `_gitignore` (npm strips `.gitignore` files from packages);
    // rename it on scaffold so the new project starts with a proper .gitignore.
    const dest = path.join(root, file === "_gitignore" ? ".gitignore" : file);
    if (file === "package.json") {
      const pkg = JSON.parse(fs.readFileSync(src, "utf-8"));
      pkg.name = path.basename(root);
      fs.writeFileSync(dest, JSON.stringify(pkg, null, 2) + "\n");
    } else {
      copy(src, dest);
    }
  }

  // Tailwind: the toolchain compiles any stylesheet that imports Tailwind, so we
  // just prepend the import to the app's global stylesheet — no extra config/deps.
  if (styling === "tailwind") {
    const cssPath = path.join(root, "app", "global.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    fs.writeFileSync(cssPath, `@import "tailwindcss";\n\n${css}`);
  }

  const rel = path.relative(process.cwd(), root);
  console.log(`\n${green("✔")} ${bold(cyan("OTF Web"))} project created! 🚀\n`);
  console.log(`  ${reset("Next steps (the toolchain runs on Bun):")}\n`);
  if (rel) console.log(`  ${cyan(`cd ${rel}`)}`);
  console.log(`  ${cyan("bun install")}`);
  console.log(`  ${cyan("bun run dev")}\n`);
}

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

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true });
  }
}

init().catch((e) => console.error(e));
