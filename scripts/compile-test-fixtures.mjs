#!/usr/bin/env esdev

// Precompile JSX test fixtures with otfwc so `esdev test` can import them.
//
// `esdev test` runs files unaltered and applies no bundler plugins — only the
// `jsx` section in esdev.json. Framework components need otfwc semantics
// (signals, custom elements), which no generic JSX runtime reproduces, so each
// fixture is compiled ahead of time to a sibling `*.compiled.js` (plain JS,
// git-ignored) that the test files import.
//
// Two rewrites make the output esdev-runnable, and both mirror what the real
// pipeline does for free:
//   1. `from "@opentf/web"` → `from "@opentf/web/test"`. The package root ships
//      `components/Link.jsx` as source, which esdev cannot load; the `/test`
//      entry is the same surface with `Link` taken from its precompiled module.
//   2. Relative `from "./X.jsx"` → `from "./X.compiled.js"`. The compiler
//      preserves source-relative imports, so a compiled component would pull its
//      siblings' raw JSX. Relatives are followed transitively — compiling
//      `Sidebar.jsx` also compiles the `SidebarNode.jsx` it renders.
//
// Usage: esdev scripts/compile-test-fixtures.mjs [path...] (a .jsx file or a
// directory of them; directories compile every top-level *.jsx as a component).
// With no args, compiles the web-form fixtures plus the components the runtime
// and web-docs suites mount. Requires the otfwc binary: `OTFWC_BIN` or
// <root>/target/debug/otfwc (built by `tsr build-compiler`).

import { readDir, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { args, env } from "runtime:process";
import { Command } from "runtime:system";

const root = dirname(dirname(fromFileURL(import.meta.url)));
const otfwc = env.OTFWC_BIN ?? join(root, "target", "debug", "otfwc");
const text = new TextDecoder();
const TEST_ENTRY = "@opentf/web/test";

const defaults = [
  "packages/web-form/tests",
  "packages/web/components/Link.jsx",
  "packages/web-docs/components/Sidebar.jsx",
  "packages/web-docs/components/SidebarToggle.jsx",
];
const targets = args.length > 0 ? [...args] : defaults;

// A target is a file or a directory; directories contribute every top-level
// *.jsx as a component. Returns absolute source paths.
async function expand(target) {
  const abs = join(root, target);
  if (target.endsWith(".jsx")) return [abs];
  const out = [];
  for (const entry of await readDir(abs)) {
    if (entry.isFile && entry.name.endsWith(".jsx")) out.push(join(abs, entry.name));
  }
  return out;
}

const queue = [];
for (const target of targets) queue.push(...(await expand(target)));
const seen = new Set(queue);

async function compile(source) {
  const proc = await new Command(otfwc, {
    args: ["build", "--component", source],
    stdout: "piped",
    stderr: "piped",
    inheritEnv: true,
  }).output();
  if (!proc.success) {
    console.error(text.decode(proc.stderr));
    throw new Error(`otfwc failed for ${source} (exit ${proc.code})`);
  }
  return text.decode(proc.stdout);
}

// Rewrite one emitted module, queueing the relative .jsx siblings it names so
// the transitive closure is compiled too. Returns the rewritten source.
function rewrite(code, source, onDep) {
  // Rule 2 first, so newly introduced .compiled.js names are not re-scanned.
  const withSiblings = code.replace(
    /(from\s*["'])(\.[^"']*?)\.jsx(["'])/g,
    (_m, head, stem, tail) => {
      onDep(join(dirname(source), `${stem}.jsx`));
      return `${head}${stem}.compiled.js${tail}`;
    },
  );
  // Rule 1: the package root (whose JSX source esdev cannot load) → test entry.
  return withSiblings.replace(/(from\s*["'])@opentf\/web(["'])/g, `$1${TEST_ENTRY}$2`);
}

let compiled = 0;
for (let i = 0; i < queue.length; i++) {
  const source = queue[i];
  const dir = dirname(source);
  const base = source.split("/").pop().replace(/\.jsx$/, "");
  const code = rewrite(
    await compile(source),
    source,
    (dep) => {
      if (dep.endsWith(".jsx") && !seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    },
  );
  // A named-but-absent dependency fails loudly at its own `compile()` call
  // below — a silent skip would leave a raw-.jsx import for `esdev test` to
  // choke on later.
  await write(join(dir, `${base}.compiled.js`), code);
  console.log(`compiled ${source.slice(root.length + 1)} -> ${base}.compiled.js`);
  compiled++;
}
console.log(`${compiled} fixture(s) compiled with ${otfwc}`);
