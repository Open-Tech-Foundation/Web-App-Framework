import { expect, test } from "runtime:test";
import { dirname, fromFileURL, join, toFileURL } from "runtime:path";
import { Command } from "runtime:system";
import { discard, tempDir, writeFile } from "../../web-cli/tests/fixture.js";
import { readFrontmatter } from "../build/frontmatter.js";

async function read(source) {
  const dir = await tempDir("frontmatter");
  try {
    const path = join(dir, "page.mdx");
    await writeFile(path, `---\n${source}\n---\n# Example`);
    return await readFrontmatter(path);
  } finally { await discard(dir); }
}

test("quoted numeric and boolean frontmatter values remain strings", async () => {
  expect(await read(`title: "001"
description: 'false'
flag: "true"
amount: '1.25'
exponent: "1e3"
empty: ''`)).toEqual({ title: "001", description: "false", flag: "true", amount: "1.25", exponent: "1e3", empty: "" });
});

test("frontmatter removes only one matching pair and preserves inner or unmatched quotes", async () => {
  expect(await read(`title: "'quoted'"
description: '"quoted"'
incomplete: "001'
marker: "`)).toEqual({ title: "'quoted'", description: '"quoted"', incomplete: '"001\'', marker: '"' });
});

test("unquoted booleans and numbers retain their types alongside empty and date strings", async () => {
  expect(await read("enabled: true\nhidden: false\norder: 2\namount: 1.25\nempty:\ndate: 2026-10-03"))
    .toEqual({ enabled: true, hidden: false, order: 2, amount: 1.25, empty: "", date: "2026-10-03" });
});

test("native compiled MDX metadata loads as valid JavaScript and agrees with the docs reader", async () => {
  const root = dirname(dirname(dirname(dirname(fromFileURL(import.meta.url)))));
  const dir = await tempDir("frontmatter-compiled");
  try {
    const path = join(dir, "page.mdx");
    await writeFile(path, `---
title: "001"
description: "false"
flag: 'true'
amount: "1.25"
order: 2
enabled: false
---
# Example`);
    const result = await new Command(join(root, "target/debug/otfwc"), {
      args: ["build", path], cwd: root, inheritEnv: true,
    }).output();
    if (!result.success) throw Error(new TextDecoder().decode(result.stderr));
    const declaration = new TextDecoder().decode(result.stdout).split("\n")
      .find(line => line.startsWith("export const metadata ="));
    expect(typeof declaration).toBe("string");
    const output = join(dir, "metadata.mjs");
    await writeFile(output, declaration);
    const { metadata } = await import(toFileURL(output).href);
    expect(metadata).toEqual(await readFrontmatter(path));
    expect(metadata.title).toBe("001");
    expect(metadata.description).toBe("false");
  } finally { await discard(dir); }
});
