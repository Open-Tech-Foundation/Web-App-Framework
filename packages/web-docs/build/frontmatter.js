// Minimal YAML frontmatter reader for the nav generator.
//
// Mirrors the flat-scalar parser in the Rust MDX front-end
// (crates/otfw_compiler/src/mdx.rs `frontmatter_object`): a leading `---` block of
// `key: value` lines, scalars only. Booleans/numbers are coerced; everything else is
// a string. Nested maps / lists are out of scope (a follow-up, same as the Rust side).

import { readFileSync } from "node:fs";

/** Parse the leading frontmatter block of an .mdx/.md file into a flat object. */
export function readFrontmatter(file) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const m = source.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    // Strip a single matching pair of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") out[key] = true;
    else if (value === "false") out[key] = false;
    else if (value !== "" && !Number.isNaN(Number(value))) out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}
