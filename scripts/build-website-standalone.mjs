#!/usr/bin/env bun

import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const website = join(root, "website");
const outDir = join(website, "dist");
const tmpRoot = mkdtempSync(join(tmpdir(), "otfw-website-"));
const tmpSite = join(tmpRoot, "website");
const bunTmp = join(tmpRoot, ".bun-tmp");

function run(argv, cwd) {
  const command = [process.execPath, ...argv];
  console.log(`$ bun ${argv.join(" ")}`);
  const proc = Bun.spawnSync(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      // Keep Bun temp/cache files inside the standalone build tree on hosts with
      // strict temp-dir policies.
      BUN_TMPDIR: bunTmp,
    },
  });
  if (proc.error) throw proc.error;
  if (proc.exitCode !== 0) process.exit(proc.exitCode);
}

function copyWebsite() {
  cpSync(website, tmpSite, {
    recursive: true,
    filter(source) {
      const name = basename(source);
      return name !== "node_modules" && name !== "dist";
    },
  });
}

try {
  console.log(`Building website outside the workspace: ${tmpSite}`);
  mkdirSync(bunTmp, { recursive: true });
  copyWebsite();
  run(["install"], tmpSite);
  run(["run", "build"], tmpSite);

  rmSync(outDir, { recursive: true, force: true });
  cpSync(join(tmpSite, "dist"), outDir, { recursive: true });
  console.log(`Copied standalone build output to ${outDir}`);
} finally {
  if (!process.env.OTFW_KEEP_STANDALONE_BUILD) {
    rmSync(tmpRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept standalone build tree at ${tmpRoot}`);
  }
}
