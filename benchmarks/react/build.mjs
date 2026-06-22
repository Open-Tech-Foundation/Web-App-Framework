#!/usr/bin/env bun
// Build the React benchmark case into dist/ with Bun's bundler.
//
// Production mode is essential: development React ships dev-only warnings and
// slow paths that would make the comparison meaningless. `NODE_ENV=production`
// lets the bundler strip them, matching how React is actually shipped.

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const dist = join(HERE, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const res = await Bun.build({
  entrypoints: [join(HERE, "src/main.jsx")],
  outdir: join(dist, "assets"),
  minify: true,
  naming: "bundle-[hash].[ext]",
  define: { "process.env.NODE_ENV": '"production"' },
});

if (!res.success) {
  for (const log of res.logs) console.error(log);
  process.exit(1);
}

const entry = res.outputs.find((o) => o.kind === "entry-point") ?? res.outputs[0];
const bundleHref = `/assets/${basename(entry.path)}`;

cpSync(join(HERE, "global.css"), join(dist, "global.css"));
writeFileSync(
  join(dist, "index.html"),
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React — Benchmark</title>
  <link rel="stylesheet" href="/global.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${bundleHref}"></script>
</body>
</html>
`,
);

console.log(`react build → dist/  (${bundleHref})`);
