#!/usr/bin/env esdev
// Write the 1x…32x fixtures used by the SSG build benchmark (see README.md).
//
//   esdev benchmarks/ssg-build/make-ladder.mjs path/to/spec.mdx ./out
//
// Each variant repeats the source's **body** while keeping a single frontmatter
// block, so every size stays a valid MDX page with the same mix of constructs
// (headings, fenced code, GFM tables, raw HTML blocks) — only its length changes.
// That is what isolates "cost as a page grows" from "cost of a different page".

import { file, mkdir, write } from "runtime:fs";
import { join, resolve } from "runtime:path";
import { args, cwd, exit } from "runtime:process";

const MULTIPLES = [1, 2, 4, 8, 16, 32];

const [sourceArg, outDirArg = "."] = args;
const source = sourceArg ? resolve(cwd(), sourceArg) : null;
const outDir = resolve(cwd(), outDirArg);
if (!source) {
  console.error("usage: esdev benchmarks/ssg-build/make-ladder.mjs <source.mdx> [outDir]");
  exit(1);
}

const src = await file(source).text();
// Split "---\n<frontmatter>\n---\n<body>" at the *second* delimiter and keep
// everything after it as the body — `split("---", 3)` would discard the
// remainder rather than return it, and the body contains `---` rules of its own.
const open = src.indexOf("---");
const close = open === -1 ? -1 : src.indexOf("---", open + 3);
if (close === -1) {
  console.error(`✗ ${source} has no frontmatter block to preserve`);
  exit(1);
}
const frontmatter = src.slice(open, close + 3);
const body = src.slice(close + 3);

await mkdir(outDir, { recursive: true });
for (const multiple of MULTIPLES) {
  const out = frontmatter + body.repeat(multiple);
  const outputPath = join(outDir, `spec-${multiple}x.mdx`);
  await write(outputPath, out);
  console.log(`${outputPath}  ${Math.round(out.length / 1024)}KB`);
}
