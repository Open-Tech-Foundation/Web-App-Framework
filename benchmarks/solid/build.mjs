#!/usr/bin/env bun
// Build the Solid benchmark case. Solid's JSX is compiled by babel-preset-solid
// into fine-grained `solid-js/web` DOM calls (no VDOM), so we run Babel over
// .jsx via a Bun bundler plugin, then let Bun bundle + minify the result.

import { transformAsync } from "@babel/core";
import solidPreset from "babel-preset-solid";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const dist = join(HERE, "dist");

const solidJsx = {
  name: "solid-jsx",
  setup(build) {
    build.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const src = await Bun.file(args.path).text();
      const out = await transformAsync(src, {
        filename: args.path,
        presets: [[solidPreset, { generate: "dom", hydratable: false }]],
        babelrc: false,
        configFile: false,
        sourceMaps: false,
      });
      return { contents: out.code, loader: "js" };
    });
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const res = await Bun.build({
  entrypoints: [join(HERE, "src/main.jsx")],
  outdir: join(dist, "assets"),
  minify: true,
  naming: "bundle-[hash].[ext]",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [solidJsx],
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
  <title>Solid — Benchmark</title>
  <link rel="stylesheet" href="/global.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${bundleHref}"></script>
</body>
</html>
`,
);

console.log(`solid build → dist/  (${bundleHref})`);
