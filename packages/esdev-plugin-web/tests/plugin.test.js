import { afterAll, expect, test } from "runtime:test";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { Command } from "runtime:system";
import webPlugin, { closeCompilers, createOtfwPlugin, createWebPlugin } from "../index.js";

afterAll(closeCompilers);

test("framework resolution selects the server entry only for server rendering", async () => {
  const calls = [];
  const ctx = { platform: "server", async resolve(source, importer) {
    calls.push([source, importer]); return { id: "/pkg/server/index.js" };
  } };
  for (const routes of [true, false]) {
    const plugin = webPlugin({ routes });
    for (const source of ["@opentf/web", "@opentf/web/runtime"]) {
      expect(await plugin.resolve.handler(source, "/app/shared.js", ctx)).toEqual({ id: "/pkg/server/index.js" });
      expect(await plugin.resolve.handler(source, "/app/shared.js", { ...ctx, platform: "browser" })).toBeNull();
    }
  }
  expect(calls).toEqual(Array.from({ length: 4 }, () => ["@opentf/web/server", "/app/shared.js"]));
  expect(await createOtfwPlugin({ target: "ssg" }).resolve.handler("@opentf/web", "/app/shared.js", { ...ctx, platform: "browser" })).toEqual({ id: "/pkg/server/index.js" });
  for (const target of ["csr", "hydrate"]) {
    expect(await createOtfwPlugin({ target }).resolve.handler("@opentf/web", "/app/shared.js", ctx)).toBeNull();
  }
});

const source = 'export default function Home() { let value = $state("Hello"); return <p>{value}</p>; }';

test("the default factory combines the compiler and virtual route hooks", () => {
  expect(webPlugin).toBe(createWebPlugin);
  const plugin = webPlugin();
  expect(plugin.name).toBe("otfw");
  expect(typeof plugin.transform.handler).toBe("function");
  expect(typeof plugin.resolve.handler).toBe("function");
  expect(typeof plugin.load.handler).toBe("function");
  expect(typeof webPlugin({ routes: false }).resolve.handler).toBe("function");
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

test("only hot browser CSR builds emit component refresh and state slots", async () => {
  const component = 'export default function Counter() { let count = $state(0); return <button onclick={() => count++}>{count}</button>; }';
  for (const hot of [true, false]) {
    const result = await webPlugin().transform.handler(component, "/app/Counter.jsx", {
      command: "start", platform: "browser", hot,
    });
    expect(result.code.includes("@opentf/web/hmr")).toBe(hot);
    expect(result.code.includes('hotState(this, "count", () => signal(0))')).toBe(hot);
    expect(result.code.includes("registerHotModule(import.meta.hot,")).toBe(hot);
    expect(result.map.sourcesContent).toEqual([component]);
  }
  const server = await webPlugin({ mode: "ssr" }).transform.handler(component, "/app/Counter.jsx", {
    command: "start", platform: "server", hot: true,
  });
  expect(server.code).not.toContain("@opentf/web/hmr");
});

test("mixed helper exports remain reload boundaries", async () => {
  const result = await webPlugin().transform.handler('export const value = 1; export default function Box() { return <p>Box</p>; }', "/Box.jsx", {
    command: "start", platform: "browser", hot: true,
  });
  expect(result.code).toContain("registerHotModule(import.meta.hot,");
  expect(result.code).toContain(", false);");
});

test("hot pages expose refresh factories and production pages stay plain", async () => {
  for (const hot of [true, false]) {
    const result = await webPlugin().transform.handler(source, "/app/page.jsx", {
      command: hot ? "start" : "build", platform: "browser", hot,
    });
    expect(result.code.includes("registerHotRoute(import.meta.hot, __otfwRoute, true)")).toBe(hot);
    expect(result.code.includes("@opentf/web/hmr")).toBe(hot);
  }
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
    await write(join(scratch, "app/shared.js"), 'import * as web from "@opentf/web"; export const Theme = web.createContext("Default");');
    await write(join(scratch, "app/page.jsx"), 'import { router, Link, ContextProvider, RawHtml, onMount } from "@opentf/web"; import { Theme } from "./shared.js"; export default function Home() { let value = $state("Hello"); const theme = $context(Theme); onMount(() => {}); return <section><p>{value}</p><Link href="/next" class={{ active: true }}>{router.data?.message || theme}</Link><ContextProvider context={Theme} value="Provided"><RawHtml html="<b>Trusted</b>"/></ContextProvider></section>; }');
    await write(join(scratch, "entry.js"), 'import { mountApp } from "@opentf/web"; import { pages, loaderRoutes } from "@otfw/routes"; mountApp({ pages, loaders: loaderRoutes, target: document.getElementById("app") });');
    await write(join(scratch, "index.html"), '<html><body><div id="app"></div><script type="module" src="./entry.js"></script></body></html>');
    await mkdir(join(scratch, "app/api/hello"), { recursive: true });
    await write(join(scratch, "app/api/hello/route.js"), 'export function GET(request, context) { return Response.json({ message: "API", source: context.locals.source }); }');
    await write(join(scratch, "app/loader.js"), 'export default function({ query, request, locals }) { return { message: query.message || "Loader", source: locals.source, liveRequest: request instanceof Request }; }');
    await write(join(scratch, "app/_middleware.js"), 'export default async function(request, context, next) { context.locals.source = "middleware"; const response = await next(); response.headers.set("x-otf-middleware", "yes"); return response; }');
    await write(join(scratch, "server.js"), `
      import { pages } from "@otfw/routes";
      import { createApiHandler, createLoaderRegistry, createMiddleware } from "@opentf/web/server";
      import { registerRoutes } from "@opentf/web";
      import { serve } from "runtime:http";
      import * as endpoint from "./app/api/hello/route.js";
      import * as loader from "./app/loader.js";
      import * as middlewareModule from "./app/_middleware.js";
      const { default: Home } = await pages["/app/page.jsx"]();
      if (typeof HTMLElement !== "undefined" || typeof document !== "undefined") throw Error("SSR must stay DOM-free");
      registerRoutes(pages);
      const initial = Home();
      if (!initial.includes('href="/next"') || !initial.includes('class="active"') || !initial.includes('Default') || !initial.includes('<b>Trusted</b>')) throw Error("SSR framework imports failed");
      console.log(Home());
      const api = createApiHandler({ "/app/api/hello/route.js": endpoint });
      const loaders = createLoaderRegistry({ "/app/loader.js": loader });
      const middleware = createMiddleware({ "/app/_middleware.js": middlewareModule });
      const handler = request => middleware.run(request, async (req, context) => {
        const apiResponse = await api(req, undefined, undefined, { locals: context.locals });
        if (apiResponse) return apiResponse;
        const dataResponse = await loaders.handle(req, { locals: context.locals });
        if (dataResponse) return dataResponse;
        const url = new URL(req.url);
        const data = await loaders.load(loaders.match(url.pathname), { request: req, query: Object.fromEntries(url.searchParams), locals: context.locals });
        return new Response(Home() + JSON.stringify(data), { headers: { "content-type": "text/html" } });
      });
      const server = serve({ hostname: "127.0.0.1", port: 0 }, handler);
      try {
        const origin = "http://127.0.0.1:" + (await server.addr).port;
        const apiResponse = await fetch(origin + "/api/hello");
        const apiData = await apiResponse.json();
        if (apiData.source !== "middleware" || apiResponse.headers.get("x-otf-middleware") !== "yes") throw Error("API middleware failed");
        const data = await (await fetch(origin + "/__data.json?message=Query")).json();
        if (data.message !== "Query" || data.source !== "middleware" || !data.liveRequest) throw Error("loader context failed");
        const html = await (await fetch(origin + "/?message=SSR")).text();
        if (!html.includes("Hello") || !html.includes('"message":"SSR"')) throw Error("SSR request failed");
        console.log("native fullstack HTTP verified");
      } finally { await server.stop(); }
    `);
    await write(join(scratch, "esdev.json"), JSON.stringify({
      plugins: [{ module: "@opentf/esdev-plugin-web", options: { mode: "ssr" } }],
      build: { targets: {
        web: { entry: "index.html", outdir: "dist" },
        server: { entry: "server.js", out: "server.mjs", platform: "server" },
      } },
    }));
    const executable = env.ESDEV_BIN || "esdev";
    const built = await new Command(executable, {
      args: ["build", "--sourcemap", `--config=${join(scratch, "esdev.json")}`], cwd: scratch, inheritEnv: true, env: { OTFWC_BIN: join(root, "target/debug/otfwc") },
    }).output();
    if (!built.success) throw new Error(new TextDecoder().decode(built.stderr));
    expect(new TextDecoder().decode(built.stderr)).not.toContain("SOURCEMAP_BROKEN");
    expect(await file(join(scratch, "dist/index.html")).text()).toContain("/assets/");
    const rendered = await new Command(executable, {
      args: [join(scratch, "server.mjs")], cwd: scratch, inheritEnv: true, env: { OTFWC_BIN: join(root, "target/debug/otfwc") },
    }).output();
    if (!rendered.success) throw new Error(new TextDecoder().decode(rendered.stderr));
    expect(new TextDecoder().decode(rendered.stdout)).toContain("Hello<!--/--></p>");
    expect(new TextDecoder().decode(rendered.stdout)).toContain("native fullstack HTTP verified");

    // Verify the composed bundle map using esdev's independent stack consumer,
    // including the dynamically imported route chunk's external .map file.
    await write(join(scratch, "app/page.jsx"), `export default function Home() {
  let value = $state("Hello");
  const explode = () => {
    throw new Error("bundled-source-map-probe");
  };
  return <p>{explode()}</p>;
}`);
    const rebuilt = await new Command(executable, {
      args: ["build", "--sourcemap", "--target=server", `--config=${join(scratch, "esdev.json")}`],
      cwd: scratch, inheritEnv: true, env: { OTFWC_BIN: join(root, "target/debug/otfwc") },
    }).output();
    if (!rebuilt.success) throw new Error(new TextDecoder().decode(rebuilt.stderr));
    const failed = await new Command(executable, {
      args: [join(scratch, "server.mjs")], cwd: scratch, inheritEnv: true,
    }).output();
    expect(failed.success).toBe(false);
    const stack = new TextDecoder().decode(failed.stderr);
    expect(stack).toContain("bundled-source-map-probe");
    expect(stack).toContain("app/page.jsx:4:11");
  } finally {
    await remove(scratch, { recursive: true });
  }
});
