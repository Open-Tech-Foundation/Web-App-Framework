import { expect, test } from "runtime:test";
import { copy, exists, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { Command } from "runtime:system";
import { createSearch } from "../../web-docs/search.js";

const root = dirname(dirname(dirname(dirname(fromFileURL(import.meta.url)))));
const executable = env.ESDEV_BIN || "esdev";

test("finish indexes prerendered staging, preserves overrides, and protects deployment on failure", async () => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const dir = await makeTempDir({ dir: join(root, ".cache"), prefix: "site-output-" });
  const configPath = join(dir, "esdev.json");
  const output = join(dir, "dist");
  const originalFetch = globalThis.fetch;
  const run = (args = [], overrides = {}) => new Command(executable, {
    args: ["build", `--config=${configPath}`, ...args], cwd: dir, inheritEnv: true,
    env: { OTFWC_BIN: join(dir, "bin/otfwc"), ...overrides },
    timeout: 15000,
  }).output();
  try {
    // Exercise the package's published entry points in an installed project.
    async function copyPath(from, to) {
      if ((await stat(from)).isDir) {
        await mkdir(to, { recursive: true });
        for (const entry of await readDir(from)) await copyPath(join(from, entry.name), join(to, entry.name));
      } else {
        await mkdir(dirname(to), { recursive: true });
        await copy(from, to);
      }
    }
    for (const name of ["web", "web-cli", "web-docs", "web-compiler", "esdev-plugin-web"]) {
      const source = join(root, "packages", name);
      const manifest = await file(join(source, "package.json")).json();
      for (const path of ["package.json", ...manifest.files.filter(path => !path.startsWith("!") && path !== "bin")]) {
        await copyPath(join(source, path), join(dir, "node_modules/@opentf", name, path));
      }
    }
    await mkdir(join(dir, "bin"), { recursive: true });
    for (const name of ["otfwc"]) await copy(join(root, "target/debug", name), join(dir, "bin", name));
    await write(join(dir, "package.json"), '{"type":"module"}');
    await mkdir(join(dir, "app/blog/hello"), { recursive: true });
    await mkdir(join(dir, "public/blog"), { recursive: true });
    await write(join(dir, "app/blog/hello/page.mdx"), "---\ntitle: Hello\ndate: 2026-10-01\n---\n# Hello\nPost body");
    await write(join(dir, "public/llms-full.txt"), "Custom full context");
    await write(join(dir, "public/blog/rss.xml"), "Custom RSS");
    await write(join(dir, "otfw.config.json"), JSON.stringify({ site: { url: "https://example.com" }, docs: { title: "Fixture", search: { provider: "otf" } }, blog: {} }));
    await write(join(dir, "index.html"), '<html><head></head><body><div id="app"></div></body></html>');
    await write(join(dir, "prerender.js"), `
import { write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { writePrerenderReport } from "@opentf/web-cli/ssg";
const out = join(dirname(fromFileURL(import.meta.url)), "../dist");
await write(join(out, "index.html"), '<main data-otf-search-body><h1>Rendered fixture</h1><h2 id="routing">Routing</h2><p>FinishHookSentinel</p></main>');
await writePrerenderReport(out, { siteDescription: "Resolved home description & details" });
`);
    await write(configPath, JSON.stringify({
      plugins: [{ module: "@opentf/web-cli/ssg", export: "siteOutputPlugin", options: { root: dir, target: "web", prerenderTarget: "prerender" } }],
      build: { targets: {
        web: { entry: "index.html", outdir: "dist", assets: ["public"] },
        prerender: { entry: "prerender.js", out: ".ssg/prerender.js", then: "run" },
      } },
    }));
    const good = await run();
    if (!good.success) throw Error(new TextDecoder().decode(good.stderr));
    expect(await exists(join(output, ".otfw-prerender.json"))).toBe(false);
    expect(await file(join(output, "llms-full.txt")).text()).toBe("Custom full context");
    expect(await file(join(output, "blog/rss.xml")).text()).toBe("Custom RSS");
    expect(await file(join(output, "blog/atom.xml")).text()).toContain("https://example.com/blog/hello");
    expect(await file(join(output, "llms.txt")).text()).toContain("Resolved home description & details");
    globalThis.fetch = async url => new Response(await file(join(output, String(url).replace(/^\//, ""))).arrayBuffer());
    const results = await createSearch().query("FinishHookSentinel");
    expect(results.results[0].url).toBe("/#routing");
    globalThis.fetch = originalFetch;
    const manifest = await file(join(output, "_search/manifest.json")).text();
    await write(join(output, "deployment-sentinel.txt"), "Last working build");
    const bad = await run([], { OTFWC_BIN: join(dir, "missing-indexer") });
    expect(bad.success).toBe(false);
    expect(new TextDecoder().decode(bad.stderr)).toContain("missing-indexer");
    expect(await file(join(output, "deployment-sentinel.txt")).text()).toBe("Last working build");
    expect(await file(join(output, "_search/manifest.json")).text()).toBe(manifest);
    const prerenderPath = join(dir, "prerender.js");
    const prerenderSource = await file(prerenderPath).text();
    await write(prerenderPath, prerenderSource.replace(/await writePrerenderReport\([^\n]+\);/, ""));
    const missingReport = await run();
    expect(missingReport.success).toBe(false);
    expect(new TextDecoder().decode(missingReport.stderr)).toContain("must call writePrerenderReport");
    expect(await file(join(output, "deployment-sentinel.txt")).text()).toBe("Last working build");
    await write(prerenderPath, prerenderSource);
    const partial = await run(["--target=web"]);
    if (!partial.success) throw Error(new TextDecoder().decode(partial.stderr));
    expect(await file(join(output, "_search/manifest.json")).text()).toBe(manifest);
    expect(await exists(join(output, ".otfw-prerender.json"))).toBe(false);
    // A broken indexer cannot stop development: neither finish nor the prerender
    // step should run there, and development must preserve the release index.
    const port = 20000 + Math.floor(Math.random() * 20000);
    const dev = await new Command(executable, {
      args: ["start", `--config=${configPath}`, `--port=${port}`], cwd: dir, inheritEnv: true,
      env: { OTFWC_BIN: join(dir, "missing-indexer") }, stdout: "piped", stderr: "piped",
    }).spawn();
    const logs = Promise.all([new Response(dev.stdout).text(), new Response(dev.stderr).text()]);
    let html, lastProblem;
    try {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`);
          if (response?.ok) { html = await response.text(); break; }
          lastProblem = response?.status;
        } catch (error) { lastProblem = error.message; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (html === undefined) throw Error(`Development server did not serve the fixture: ${lastProblem}`);
      expect(html).toContain('id="app"');
      expect(html).not.toContain("FinishHookSentinel");
      expect(await file(join(output, "_search/manifest.json")).text()).toBe(manifest);
    } finally {
      dev.kill(); await dev.status;
      const output = await logs;
      if (!html) console.error(output.join("\n"));
    }
  } finally {
    globalThis.fetch = originalFetch;
    await remove(dir, { recursive: true });
  }
});
