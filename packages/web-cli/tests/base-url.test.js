import { join } from "runtime:path";
import { cwd } from "runtime:process";
import { Command } from "runtime:system";

import { discard, tempDir, writeTree } from "./fixture.js";
import { describe, expect, test } from "./harness.js";

import { buildRequiresBaseUrl, resolveBaseUrl } from "../src/build.js";

const CLI = join("packages", "web-cli", "src", "cli.js");

/**
 * Run `otfw build` against a throwaway project, from the repository root.
 *
 * The runtime sandboxes a program to its working directory, so the CLI and the
 * project it builds have to share one — which the repository root already is: the
 * toolchain lives under it, and so does the scratch project `--root` points at.
 */
async function buildProject(config) {
  const root = await tempDir("otfw-missing-site-url");
  try {
    await writeTree(root, { "otfw.config.json": JSON.stringify(config) });
    const proc = await new Command("esdev", {
      args: [CLI, "build", `--root=${root}`],
      cwd: cwd(),
      stdout: "piped",
      stderr: "piped",
      inheritEnv: true,
    }).output();
    return { code: proc.code, stderr: new TextDecoder().decode(proc.stderr) };
  } finally {
    await discard(root);
  }
}

describe("resolveBaseUrl", () => {
  test("uses --base-url before config and trims trailing slashes", () => {
    expect(
      resolveBaseUrl({ site: { url: "https://config.example" } }, [
        "--base-url=https://deploy.example///",
      ]),
    ).toBe("https://deploy.example");
  });

  test("uses config site.url when no flag is present", () => {
    expect(resolveBaseUrl({ site: { url: "https://example.com/" } }, [])).toBe("https://example.com");
  });

  test("treats null site.url as missing", () => {
    expect(resolveBaseUrl({ site: { url: null } }, [])).toBe("");
  });
});

describe("buildRequiresBaseUrl", () => {
  test("requires a base URL for docs, blog, or SSG builds", () => {
    expect(buildRequiresBaseUrl({ docs: {} }, [])).toBe(true);
    expect(buildRequiresBaseUrl({ blog: {} }, [])).toBe(true);
    expect(buildRequiresBaseUrl({}, ["--ssg"])).toBe(true);
  });

  test("does not require a base URL for plain CSR apps without docs or blog config", () => {
    expect(buildRequiresBaseUrl({}, [])).toBe(false);
  });
});

describe("production build validation", () => {
  test("fails on missing site.url before project/compiler resolution", async () => {
    const { code, stderr } = await buildProject({ site: { url: null }, docs: {} });

    expect(code).toBe(1);
    expect(stderr).toContain("site.url is required");
    expect(stderr).not.toContain("no app/ directory");
    expect(stderr).not.toContain("cargo build");
  });
});
