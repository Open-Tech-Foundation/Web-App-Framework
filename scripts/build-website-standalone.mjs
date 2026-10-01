#!/usr/bin/env esdev

// Build the website as a self-contained pnpm project for the Cloudflare deploy.
// The site owns its published dependencies and lockfile; deploy the same versions
// used by its local build.

import { copy, makeTempDir, mkdir, readDir, remove } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { Command } from "runtime:system";

const root = dirname(dirname(fromFileURL(import.meta.url)));
const website = join(root, "website");
const outDir = join(website, "dist");
const cache = join(root, ".cache");
await mkdir(cache, { recursive: true });
const tmpRoot = await makeTempDir({ dir: cache, prefix: "otfw-website-" });
const tmpSite = join(tmpRoot, "website");
const text = new TextDecoder();

async function run(program, args, cwd) {
  console.log(`$ ${program} ${args.join(" ")}`);
  const out = await new Command(program, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    inheritEnv: true,
  }).output();
  if (out.stdout) console.log(text.decode(out.stdout));
  if (out.stderr) console.error(text.decode(out.stderr));
  if (!out.success) throw new Error(`${program} ${args.join(" ")} failed with exit code ${out.code}`);
}

async function copyTree(from, to, skip = new Set()) {
  await mkdir(to, { recursive: true });
  for (const entry of await readDir(from)) {
    if (skip.has(entry.name)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDir) await copyTree(source, target, skip);
    else if (entry.isFile) await copy(source, target);
  }
}

try {
  console.log(`Building website outside the workspace: ${tmpSite}`);
  await copyTree(website, tmpSite, new Set(["node_modules", "dist", ".dev", ".ssg"]));
  await run("pnpm", ["install", "--frozen-lockfile"], tmpSite);
  await run("pnpm", ["run", "build"], tmpSite);

  await remove(outDir, { recursive: true });
  await copyTree(join(tmpSite, "dist"), outDir);
  console.log(`Copied standalone build output to ${outDir}`);
} finally {
  if (!env.OTFW_KEEP_STANDALONE_BUILD) await remove(tmpRoot, { recursive: true });
  else console.log(`Kept standalone build tree at ${tmpRoot}`);
}
