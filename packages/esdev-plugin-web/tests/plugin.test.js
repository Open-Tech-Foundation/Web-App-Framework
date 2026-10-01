import { afterAll, expect, test } from "runtime:test";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { Command } from "runtime:system";
import webPlugin, { closeCompilers, createOtfwPlugin, createWebPlugin } from "../index.js";

afterAll(closeCompilers);

const source = 'export default function Home() { let value = $state("Hello"); return <p>{value}</p>; }';

test("the default factory combines the compiler and virtual route hooks", () => {
  expect(webPlugin).toBe(createWebPlugin);
  const plugin = webPlugin();
  expect(plugin.name).toBe("otfw");
  expect(typeof plugin.transform.handler).toBe("function");
  expect(typeof plugin.resolve.handler).toBe("function");
  expect(typeof plugin.load.handler).toBe("function");
  expect(webPlugin({ routes: false }).resolve).toBeUndefined();
});

test("invalid rendering options fail before the compiler starts", () => {
  expect(() => webPlugin({ mode: "invalid" })).toThrow("Unknown OTF rendering mode");
  expect(() => webPlugin({ target: "invalid" })).toThrow("Unknown OTF compiler target");
  expect(() => webPlugin({ routes: "false" })).toThrow("routes must be a boolean");
});

for (const [label, context, expected] of [
  ["server release", { command: "build", platform: "server", target: "server" }, "ssg"],
  ["server dev", { command: "start", platform: "server", target: "server" }, "ssg"],
  ["browser release", { command: "build", platform: "browser", target: "web" }, "hydrate"],
  ["browser dev", { command: "start", platform: "browser", hot: true }, "csr"],
  ["DOM test", { command: "test", platform: "browser" }, "csr"],
  ["server script", { command: "run", platform: "server" }, "ssg"],
]) {
  test(`SSR mode selects ${expected} for a ${label}`, async () => {
    const plugin = webPlugin({ mode: "ssr" });
    const result = await plugin.transform.handler(source, "/app/page.jsx", context);
    expect(result.type).toBe("js");
    expect(result.moduleSideEffects).toBe(true);
    expect(result.code.includes("@opentf/web/server")).toBe(expected === "ssg");
    expect(result.code.includes("export function hydrate")).toBe(expected === "hydrate");
  });
}

test("explicit compiler targets still override mode and hook context", async () => {
  const plugin = createOtfwPlugin({ target: "ssg", mode: "ssr" });
  const result = await plugin.transform.handler(source, "/app/page.jsx", { command: "test", platform: "browser" });
  expect(result.code).toContain("@opentf/web/server");
});

test("SPA releases use CSR and SSG releases use hydration in the browser", async () => {
  for (const [mode, hydrating] of [["spa", false], ["ssg", true]]) {
    const result = await webPlugin({ mode }).transform.handler(source, "/app/page.jsx", {
      command: "build", platform: "browser",
    });
    expect(result.code.includes("export function hydrate")).toBe(hydrating);
  }
});

test("already lowered JSX is left to the next transform", async () => {
  const plugin = webPlugin();
  expect(await plugin.transform.handler("export default 1;", "/app/page.jsx", { type: "js" })).toBeNull();
});

test("the starter plugin fails on compiler errors instead of emitting a DOM stub", async () => {
  const plugin = webPlugin();
  await expect(plugin.transform.handler("export default function {", "/app/page.jsx", {
    command: "build", platform: "browser",
    error(message) { throw new Error(message); },
  })).rejects.toThrow("otfwc failed");
});

test("a starter config loads the default factory and builds browser and server routes", async () => {
  const root = dirname(dirname(dirname(dirname(fromFileURL(import.meta.url)))));
  const cache = join(root, ".cache");
  await mkdir(cache, { recursive: true });
  const scratch = await makeTempDir({ dir: cache, prefix: "web-plugin-starter-" });
  try {
    // Materialize published package files: this project has no workspace aliases
    // or symlinks reaching outside its root, just like an installed starter.
    async function copyPath(from, to) {
      if ((await stat(from)).isDir) {
        await mkdir(to, { recursive: true });
        for (const entry of await readDir(from)) await copyPath(join(from, entry.name), join(to, entry.name));
      } else {
        await mkdir(dirname(to), { recursive: true });
        await copy(from, to);
      }
    }
    for (const name of ["web", "esdev-plugin-web", "web-compiler"]) {
      const packageDir = join(root, "packages", name);
      const manifest = await file(join(packageDir, "package.json")).json();
      for (const path of ["package.json", ...manifest.files.filter(path => !path.startsWith("!") && path !== "bin")]) {
        await copyPath(join(packageDir, path), join(scratch, "node_modules/@opentf", name, path));
      }
    }
    await mkdir(join(scratch, "app"), { recursive: true });
    await write(join(scratch, "package.json"), JSON.stringify({
      private: true, type: "module", dependencies: {
        "@opentf/web": "*", "@opentf/esdev-plugin-web": "*",
      },
    }));
    await write(join(scratch, "tsconfig.json"), "{}");
    await write(join(scratch, "app/page.jsx"), source);
    await write(join(scratch, "entry.js"), 'import { mountApp } from "@opentf/web"; import { pages } from "@otfw/routes"; mountApp({ pages, target: document.getElementById("app") });');
    await write(join(scratch, "index.html"), '<html><body><div id="app"></div><script type="module" src="./entry.js"></script></body></html>');
    await write(join(scratch, "server.js"), 'import { pages } from "@otfw/routes"; const { default: Home } = await pages["/app/page.jsx"](); console.log(Home());');
    await write(join(scratch, "esdev.json"), JSON.stringify({
      plugins: [{ module: "@opentf/esdev-plugin-web", options: { mode: "ssr" } }],
      build: { targets: {
        web: { entry: "index.html", outdir: "dist" },
        server: { entry: "server.js", out: "server.mjs", platform: "server" },
      } },
    }));
    const executable = env.ESDEV_BIN || "esdev";
    const built = await new Command(executable, {
      args: ["build", `--config=${join(scratch, "esdev.json")}`], cwd: scratch, inheritEnv: true, env: { OTFWC_BIN: join(root, "target/debug/otfwc") },
    }).output();
    if (!built.success) throw new Error(new TextDecoder().decode(built.stderr));
    expect(await file(join(scratch, "dist/index.html")).text()).toContain("/assets/");
    const rendered = await new Command(executable, {
      args: [join(scratch, "server.mjs")], cwd: scratch, inheritEnv: true, env: { OTFWC_BIN: join(root, "target/debug/otfwc") },
    }).output();
    if (!rendered.success) throw new Error(new TextDecoder().decode(rendered.stderr));
    expect(new TextDecoder().decode(rendered.stdout)).toContain("Hello<!--/--></p>");
  } finally {
    await remove(scratch, { recursive: true });
  }
});
