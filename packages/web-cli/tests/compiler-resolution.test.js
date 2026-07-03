import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveCompiler } from "../src/shared.js";

const tmpRoots = [];

function tmpWorkspace() {
  const root = join(tmpdir(), `otfw-compiler-resolution-${Date.now()}-${tmpRoots.length}`);
  mkdirSync(join(root, "crates", "otfw_cli"), { recursive: true });
  mkdirSync(join(root, "packages", "web-cli", "src"), { recursive: true });
  writeFileSync(join(root, "crates", "otfw_cli", "Cargo.toml"), "[package]\nname = \"otfw_cli\"\n");
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveCompiler", () => {
  test("uses OTFWC_BIN before package or workspace resolution", () => {
    const result = resolveCompiler({
      env: { OTFWC_BIN: "/custom/otfwc" },
      resolvePackagedCompiler() {
        throw new Error("should not resolve package");
      },
      findWorkspace() {
        throw new Error("should not find workspace");
      },
    });

    expect(result).toEqual({ otfwc: "/custom/otfwc", workspace: null });
  });

  test("uses the packaged compiler before a local workspace", () => {
    const workspace = tmpWorkspace();
    let ensured = false;

    const result = resolveCompiler({
      cliDir: join(workspace, "packages", "web-cli", "src"),
      env: {},
      resolvePackagedCompiler: () => "/node_modules/@opentf/web-compiler/bin/linux-x64/otfwc",
      findWorkspace: () => workspace,
      ensure() {
        ensured = true;
      },
    });

    expect(result).toEqual({
      otfwc: "/node_modules/@opentf/web-compiler/bin/linux-x64/otfwc",
      workspace: null,
    });
    expect(ensured).toBe(false);
  });

  test("falls back to the local compiler workspace when the package has no binary", () => {
    const workspace = tmpWorkspace();
    let ensured = null;

    const result = resolveCompiler({
      cliDir: join(workspace, "packages", "web-cli", "src"),
      env: {},
      resolvePackagedCompiler() {
        throw new Error("prebuilt missing");
      },
      findWorkspace: () => workspace,
      ensure(otfwc, root) {
        ensured = { otfwc, root };
      },
    });

    const otfwc = join(workspace, "target", "debug", "otfwc");
    expect(result).toEqual({ otfwc, workspace });
    expect(ensured).toEqual({ otfwc, root: workspace });
  });
});
