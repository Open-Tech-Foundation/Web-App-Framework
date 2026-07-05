#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import { cyan, green, red, reset, yellow, bold } from "kolorist";
import { detectPackageManager, devCommand } from "./detect-pm.js";
import { installDependencies } from "./install-deps.js";
import { scaffold } from "./scaffold.js";

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

  try {
    await scaffold({
      template,
      targetDir: root,
      styling,
      onResolved: (name, version) =>
        console.log(`  ${reset("Resolved")} ${cyan(name)} ${yellow(`^${version}`)}`),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${red("✖")} Could not resolve @opentf/* versions from npm — scaffolding aborted.\n` +
        `  ${detail}\n` +
        `  Check your network connection and try again.`,
    );
  }

  const pm = detectPackageManager();

  if (process.env.CREATE_WEB_SKIP_INSTALL !== "1") {
    console.log(`\n  ${reset("Installing dependencies with")} ${cyan(pm)}…\n`);
    try {
      installDependencies(root, pm);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${red("✖")} ${pm} install failed — project files were created but dependencies are not installed.\n` +
          `  ${detail}\n` +
          `  Run ${cyan(`${pm} install`)} in the project directory and try again.`,
      );
    }
  }

  const rel = path.relative(process.cwd(), root);
  console.log(`\n${green("✔")} ${bold(cyan("OTF Web"))} project created! 🚀\n`);
  console.log(`  ${reset("Next steps:")}\n`);
  if (rel) console.log(`  ${cyan(`cd ${rel}`)}`);
  if (process.env.CREATE_WEB_SKIP_INSTALL === "1") {
    console.log(`  ${cyan(`${pm} install`)}`);
  }
  console.log(`  ${cyan(devCommand(pm))}\n`);
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true });
  }
}

init().catch((e) => console.error(e));