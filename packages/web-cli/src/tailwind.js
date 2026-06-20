// Tailwind CSS v4 compilation for the dev server.
//
// We drive Tailwind's engine directly: `@tailwindcss/node` resolves `@import
// "tailwindcss"` and the theme/utility layers, and `@tailwindcss/oxide` scans the
// project for class-name candidates. This is the same engine the editor tooling
// uses, invoked as a library — no separate Tailwind config or build step.

import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { dirname } from "node:path";

// A stylesheet uses Tailwind if it pulls in the framework (v4 `@import
// "tailwindcss"`) or any legacy `@tailwind` directive. Plain CSS is served as-is.
export function usesTailwind(source) {
  return /@import\s+["']tailwindcss["']|@tailwind\b/.test(source);
}

/**
 * Compile a Tailwind entry stylesheet to plain CSS, scanning `base` (the project
 * root) for the utility classes actually used.
 *
 * @param {string} cssPath  absolute path to the entry `.css`
 * @param {string} source   its contents
 * @param {string} base     project root to scan for class-name candidates
 * @returns {Promise<string>} the generated CSS
 */
export async function compileCss(cssPath, source, base) {
  const compiler = await compile(source, {
    base: dirname(cssPath),
    onDependency: () => {},
  });
  // Decide what to scan: `source(none)` disables scanning, `source(dir)` narrows
  // it, otherwise scan the whole project root. Always include the compiler's own
  // declared sources.
  const roots =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: roots.concat(compiler.sources) });
  return compiler.build(scanner.scan());
}
