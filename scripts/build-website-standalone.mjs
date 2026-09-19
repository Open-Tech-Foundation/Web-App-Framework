#!/usr/bin/env esdev

// Build the website as a self-contained pnpm project for the Cloudflare deploy.
// The repository uses workspace links while developing, but the deploy build copies
// only `website/`. Replace those links with the versions this checkout publishes.

import { copy, file, makeTempDir, mkdir, readDir, remove, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { Command } from "runtime:system";

const root = dirname(dirname(fromFileURL(import.meta.url)));
const website = join(root, "website");
const outDir = join(website, "dist");
const tmpRoot = await makeTempDir({ dir: root, prefix: ".otfw-website-" });
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

async function localPackageVersions() {
  const versions = new Map();
  for (const entry of await readDir(join(root, "packages"))) {
    if (!entry.isDir) continue;
    try {
      const manifest = JSON.parse(await file(join(root, "packages", entry.name, "package.json")).text());
      if (manifest.name && manifest.version) versions.set(manifest.name, manifest.version);
    } catch {
      // A package directory without a manifest is not a publishable dependency.
    }
  }
  return versions;
}

async function materializeWorkspaceDependencies() {
  const versions = await localPackageVersions();
  const manifestPath = join(tmpSite, "package.json");
  const manifest = JSON.parse(await file(manifestPath).text());
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (!String(spec).startsWith("workspace:")) continue;
      const version = versions.get(name);
      if (!version) throw new Error(`website depends on local ${name}, but it has no package version`);
      manifest[section][name] = `^${version}`;
    }
  }
  await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

try {
  console.log(`Building website outside the workspace: ${tmpSite}`);
  await copyTree(website, tmpSite, new Set(["node_modules", "dist"]));
  await materializeWorkspaceDependencies();
  await run("pnpm", ["install", "--frozen-lockfile=false"], tmpSite);
  await run("pnpm", ["run", "build:ssg"], tmpSite);

  await remove(outDir, { recursive: true });
  await copyTree(join(tmpSite, "dist"), outDir);
  console.log(`Copied standalone build output to ${outDir}`);
} finally {
  if (!env.OTFW_KEEP_STANDALONE_BUILD) await remove(tmpRoot, { recursive: true });
  else console.log(`Kept standalone build tree at ${tmpRoot}`);
}
