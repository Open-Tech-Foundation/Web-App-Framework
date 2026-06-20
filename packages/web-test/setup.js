import "./init-dom.js";
import { plugin } from "bun";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach } from "bun:test";
import { cleanup } from "./index.js";

// Locate the `otfwc` IR compiler (the workspace debug build), overridable via
// OTFWC_BIN. Walk up from this file to the Cargo workspace.
function findUp(name, from) {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const workspace = findUp("Cargo.toml", import.meta.dir);
const otfwc =
  process.env.OTFWC_BIN ??
  (workspace ? join(workspace, "target", "debug", "otfwc") : "otfwc");

// Compile `.jsx`/`.tsx` test fixtures through the OpenTF Web compiler so tests can
// import components directly. Page/layout/404 modules become factories; everything
// else a Custom Element (matching the toolchain).
plugin({
  name: "otfw-jsx",
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
      const base = args.path.split("/").pop().replace(/\.[jt]sx$/, "");
      const isPage = base === "page" || base === "layout" || base === "404";
      const argv = ["build"];
      if (!isPage) argv.push("--component");
      argv.push("--stdin", args.path);
      const source = await Bun.file(args.path).text();
      const proc = Bun.spawnSync([otfwc, ...argv], {
        stdin: new TextEncoder().encode(source),
      });
      if (proc.exitCode !== 0) {
        throw new Error(`otfwc failed for ${args.path}:\n${proc.stderr.toString()}`);
      }
      return { contents: proc.stdout.toString(), loader: "js" };
    });
  },
});

afterEach(() => {
  cleanup();
});
