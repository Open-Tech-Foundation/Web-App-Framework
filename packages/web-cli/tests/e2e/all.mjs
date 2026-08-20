// Every e2e, in order, each in its own process.
//
//   esdev packages/web-cli/tests/e2e/all.mjs
//
// Run from the repository root. The order is deliberate: the cheap checks that only
// need the toolchain come first, so a broken build fails in seconds rather than after
// a browser has been started eleven times. Stops at the first failure, and forwards
// its exit code.

import { exit } from "runtime:process";
import { Command } from "runtime:system";

import { HERE, ROOT } from "./lib.js";

const SUITES = [
  "serve",
  "build-data",
  "build-metadata",
  "worker-assets",
  "dev-hmr",
  "dev-docs-hmr",
  "runtime-browser",
  "template-parity",
  "reparse-browser",
  "hydrate-browser",
  "lifecycle-hooks-browser",
];

for (const name of SUITES) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
  const { code } = await new Command("esdev", {
    args: [`${HERE}/${name}.mjs`],
    cwd: ROOT,
    inheritEnv: true,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (code !== 0) {
    console.error(`\n✗ ${name} failed (exit ${code})\n`);
    exit(code);
  }
}

console.log(`\n✓ ${SUITES.length} e2e suites passed\n`);
