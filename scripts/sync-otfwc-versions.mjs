// Keep the otfwc binary packages in lockstep with @opentf/otfwc's version:
// set every @opentf/otfwc-<platform> package version and @opentf/otfwc's
// optionalDependencies to @opentf/otfwc's current version. Run right before
// publishing (changesets bumps @opentf/otfwc; this propagates the bump).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const otfwcDir = join(root, "packages", "otfwc");

const mainPath = join(otfwcDir, "package.json");
const main = JSON.parse(readFileSync(mainPath, "utf8"));
const v = main.version;

for (const k of Object.keys(main.optionalDependencies || {})) {
  main.optionalDependencies[k] = v;
}
writeFileSync(mainPath, JSON.stringify(main, null, 2) + "\n");

const npmDir = join(otfwcDir, "npm");
for (const d of readdirSync(npmDir, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const p = join(npmDir, d.name, "package.json");
  const pkg = JSON.parse(readFileSync(p, "utf8"));
  pkg.version = v;
  writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
}

console.log(`synced @opentf/otfwc binary packages to ${v}`);
