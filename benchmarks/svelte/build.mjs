#!/usr/bin/env bun
// Build the Svelte benchmark case. .svelte files are compiled to client JS by
// the Svelte 5 compiler via a Bun bundler plugin; Bun then bundles + minifies.

import { compile } from "svelte/compiler";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const dist = join(HERE, "dist");

const sveltePlugin = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const src = await Bun.file(args.path).text();
      const { js } = compile(src, {
        filename: args.path,
        generate: "client",
        dev: false,
        runes: true,
      });
      return { contents: js.code, loader: "js" };
    });
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const res = await Bun.build({
  entrypoints: [join(HERE, "src/main.js")],
  outdir: join(dist, "assets"),
  minify: true,
  naming: "bundle-[hash].[ext]",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [sveltePlugin],
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
  <title>Svelte — Benchmark</title>
  <link rel="stylesheet" href="/global.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${bundleHref}"></script>
</body>
</html>
`,
);

console.log(`svelte build → dist/  (${bundleHref})`);
