import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildRequiresBaseUrl, resolveBaseUrl } from "../src/build.js";

describe("resolveBaseUrl", () => {
  test("uses --base-url before config and trims trailing slashes", () => {
    expect(
      resolveBaseUrl({ site: { url: "https://config.example" } }, [
        "bun",
        "otfw",
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
    expect(buildRequiresBaseUrl({}, ["bun", "otfw", "--ssg"])).toBe(true);
  });

  test("does not require a base URL for plain CSR apps without docs or blog config", () => {
    expect(buildRequiresBaseUrl({}, [])).toBe(false);
  });
});

describe("production build validation", () => {
  test("fails on missing site.url before project/compiler resolution", () => {
    const root = mkdtempSync(join(tmpdir(), "otfw-missing-site-url-"));
    try {
      writeFileSync(join(root, "otfw.config.json"), JSON.stringify({ site: { url: null }, docs: {} }));
      const proc = Bun.spawnSync([process.execPath, resolve("packages/web-cli/src/cli.js"), "build"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exitCode).toBe(1);
      expect(proc.stderr.toString()).toContain("site.url is required");
      expect(proc.stderr.toString()).not.toContain("no app/ directory");
      expect(proc.stderr.toString()).not.toContain("cargo build");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
