import { afterEach, describe, expect, test } from "runtime:test";
import { makeTempDir, mkdir, remove, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";

import { resolveCompiler } from "../index.js";

const HERE = dirname(fromFileURL(import.meta.url));
const tmpRoots = [];

/** A fresh workspace skeleton: a Cargo marker where the resolver looks for one. */
async function tmpWorkspace() {
  const root = await makeTempDir({ dir: HERE, prefix: "otfw-compiler-resolution-" });
  await mkdir(join(root, "crates", "otfw_cli"), { recursive: true });
  await write(join(root, "crates", "otfw_cli", "Cargo.toml"), '[package]\nname = "otfw_cli"\n');
  tmpRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    try {
      await remove(root, { recursive: true });
    } catch {}
  }
});

describe("resolveCompiler", () => {
  test("uses OTFWC_BIN before package or workspace resolution", async () => {
    const result = await resolveCompiler({
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

  test("uses the packaged compiler before a local workspace", async () => {
    const workspace = await tmpWorkspace();
    let ensured = false;

    const result = await resolveCompiler({
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

  test("falls back to the local compiler workspace when the package has no binary", async () => {
    const workspace = await tmpWorkspace();
    let ensured = null;

    const result = await resolveCompiler({
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
