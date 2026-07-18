import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "rolldown";

import { resolveNewUrlRef, workerAssetsPlugin } from "../src/shared.js";

// Bundle `main.js` from an in-memory fixture through `workerAssetsPlugin` and
// return the entry code, the list of emitted file names, and any plugin warnings.
// Mirrors the `otfw build` output config (hashed entry/chunk/asset names, esm).
async function bundleFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "otfw-worker-assets-"));
  const outDir = join(dir, "out");
  const warnings = [];
  try {
    for (const [name, source] of Object.entries(files)) {
      writeFileSync(join(dir, name), source);
    }
    const result = await build({
      input: join(dir, "main.js"),
      onLog: (level, log) => {
        if (level === "warn") warnings.push(log.message ?? String(log));
      },
      plugins: [workerAssetsPlugin()],
      output: {
        dir: outDir,
        format: "esm",
        entryFileNames: "bundle-[hash].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name]-[hash][extname]",
      },
    });
    const names = result.output.map((o) => o.fileName);
    const entry = result.output.find((o) => o.type === "chunk" && o.isEntry && o.facadeModuleId?.endsWith("main.js"));
    return { names, entryCode: entry.code, warnings, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe("workerAssetsPlugin", () => {
  test("emits a Worker script referenced via new URL and rewrites the reference", async () => {
    const { names, entryCode } = await bundleFixture({
      "main.js": `const w = new Worker(new URL("./my-worker.js", import.meta.url), { type: "module" });\nexport { w };\n`,
      "my-worker.js": `self.onmessage = (e) => postMessage(e.data);\n`,
    });

    // The worker was emitted as its own hashed chunk…
    expect(names.some((n) => /^my-worker-.*\.js$/.test(n))).toBe(true);
    // …and the dangling literal is gone — the reference now points at that chunk.
    expect(entryCode).not.toContain('"./my-worker.js"');
    expect(entryCode).toMatch(/new URL\(new URL\("my-worker-.*\.js", import\.meta\.url\)\.href, import\.meta\.url\)/);
  });

  test("emits a bare new URL asset (e.g. .wasm) as a hashed asset", async () => {
    const { names, entryCode } = await bundleFixture({
      "main.js": `export const wasm = new URL("./thing.wasm", import.meta.url);\n`,
      "thing.wasm": "\0asm binary payload",
    });

    expect(names.some((n) => /^thing-.*\.wasm$/.test(n))).toBe(true);
    expect(entryCode).not.toContain('"./thing.wasm"');
    expect(entryCode).toMatch(/thing-.*\.wasm/);
  });

  test("recurses into nested workers (worker spawning a worker)", async () => {
    const { names } = await bundleFixture({
      "main.js": `export const w = new Worker(new URL("./outer.js", import.meta.url), { type: "module" });\n`,
      "outer.js": `const inner = new Worker(new URL("./inner.js", import.meta.url), { type: "module" });\nself.onmessage = () => inner.postMessage(1);\n`,
      "inner.js": `self.onmessage = () => postMessage("done");\n`,
    });

    expect(names.some((n) => /^outer-.*\.js$/.test(n))).toBe(true);
    expect(names.some((n) => /^inner-.*\.js$/.test(n))).toBe(true);
  });

  test("emits an asset referenced from inside a worker (nested asset URL)", async () => {
    const { names } = await bundleFixture({
      "main.js": `export const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });\n`,
      // The worker itself pulls in a .wasm via a bare `new URL` — the emitted worker
      // chunk must be re-scanned so this asset is emitted too (not left dangling).
      "worker.js": `const wasm = new URL("./kernel.wasm", import.meta.url);\nself.onmessage = () => fetch(wasm);\n`,
      "kernel.wasm": "\0asm kernel payload",
    });

    expect(names.some((n) => /^worker-.*\.js$/.test(n))).toBe(true);
    expect(names.some((n) => /^kernel-.*\.wasm$/.test(n))).toBe(true);
  });

  test("emits an asset imported through a regular module chain", async () => {
    const { names, entryCode } = await bundleFixture({
      "main.js": `export { texture } from "./mid.js";\n`,
      "mid.js": `export const texture = new URL("./sprite.png", import.meta.url);\n`,
      "sprite.png": "PNG bytes",
    });

    expect(names.some((n) => /^sprite-.*\.png$/.test(n))).toBe(true);
    // The rewrite lands in whichever chunk the mid module folded into; assert no
    // dangling literal survives anywhere in the output.
    expect(entryCode).not.toContain('"./sprite.png"');
  });

  test("handles SharedWorker and backtick specifiers", async () => {
    const { names, entryCode } = await bundleFixture({
      "main.js": "export const w = new SharedWorker(new URL(`./shared.js`, import.meta.url), { type: \"module\" });\n",
      "shared.js": `self.onconnect = (e) => e.ports[0].postMessage("hi");\n`,
    });

    expect(names.some((n) => /^shared-.*\.js$/.test(n))).toBe(true);
    expect(entryCode).not.toContain("`./shared.js`");
  });

  test("emits a shared worker/asset only once when referenced from multiple modules", async () => {
    const { names } = await bundleFixture({
      "main.js": `import "./other.js";\nexport const a = new URL("./data.bin", import.meta.url);\n`,
      "other.js": `export const b = new URL("./data.bin", import.meta.url);\n`,
      "data.bin": "shared bytes",
    });

    expect(names.filter((n) => /^data-.*\.bin$/.test(n)).length).toBe(1);
  });

  test("leaves non-relative / dynamic new URL references untouched", async () => {
    const { entryCode } = await bundleFixture({
      "main.js": `export const a = new URL("https://cdn.example/x.js", import.meta.url);\nexport const b = (n) => new URL(n, import.meta.url);\n`,
    });

    expect(entryCode).toContain('"https://cdn.example/x.js"');
    expect(entryCode).not.toContain("ROLLUP_FILE_URL");
  });

  test("a worker also referenced as a bare new URL is still a recursed chunk", async () => {
    // The worker is referenced both ways: a bare `new URL` (e.g. a prefetch link)
    // AND `new Worker`. It must be emitted as a bundled chunk (so its own nested
    // worker + asset recurse), never downgraded to a verbatim asset copy just
    // because the bare-URL reference was scanned first.
    const { names } = await bundleFixture({
      "main.js":
        `export const prefetch = new URL("./kernel-worker.js", import.meta.url);\n` +
        `export const w = new Worker(new URL("./kernel-worker.js", import.meta.url), { type: "module" });\n`,
      "kernel-worker.js":
        `new Worker(new URL("./program-worker.js", import.meta.url), { type: "module" });\n` +
        `const wasm = new URL("./grep.wasm", import.meta.url);\nself.onmessage = () => fetch(wasm);\n`,
      "program-worker.js": `self.onmessage = () => postMessage("PROGRAM_WORKER_RAN");\n`,
      "grep.wasm": "\0asm grep payload",
    });

    // The nested worker and the worker-scoped asset both emit — proving the worker
    // was bundled+recursed, not copied raw.
    expect(names.some((n) => /^program-worker-.*\.js$/.test(n))).toBe(true);
    expect(names.some((n) => /^grep-.*\.wasm$/.test(n))).toBe(true);
  });

  test("warns (does not silently drop) when a reference can't be resolved", async () => {
    // The worker exists, but its `new URL("./missing-worker.js")` points at a file
    // that isn't there — the emitted worker chunk must surface a warning, never leave
    // a silent dangling reference that 404s at runtime.
    const { names, warnings } = await bundleFixture({
      "main.js": `export const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });\n`,
      "worker.js": `new Worker(new URL("./missing-worker.js", import.meta.url), { type: "module" });\n`,
    });

    expect(names.some((n) => /^worker-.*\.js$/.test(n))).toBe(true); // the resolvable one still emits
    expect(warnings.some((w) => w.includes("missing-worker.js") && w.includes("404"))).toBe(true);
  });
});

describe("resolveNewUrlRef", () => {
  async function withTemp(fn) {
    const dir = mkdtempSync(join(tmpdir(), "otfw-resolve-"));
    try {
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("prefers ctx.resolve, then falls back to a filesystem-sibling join", async () => {
    await withTemp(async (dir) => {
      const importer = join(dir, "worker.js");
      const target = join(dir, "program-worker.js");
      writeFileSync(importer, "");
      writeFileSync(target, "");

      // ctx.resolve wins when it returns an existing, non-external id…
      const viaResolve = await resolveNewUrlRef(
        { resolve: async () => ({ id: target, external: false }) },
        "./program-worker.js",
        importer,
      );
      expect(viaResolve).toBe(target);

      // …and when the resolver can't help (null/throw), the join fallback finds the sibling.
      const viaJoin = await resolveNewUrlRef({ resolve: async () => null }, "./program-worker.js", importer);
      expect(viaJoin).toBe(target);
      const viaThrow = await resolveNewUrlRef(
        { resolve: async () => { throw new Error("no"); } },
        "./program-worker.js",
        importer,
      );
      expect(viaThrow).toBe(target);
    });
  });

  test("returns null when the target genuinely does not exist", async () => {
    await withTemp(async (dir) => {
      const importer = join(dir, "worker.js");
      writeFileSync(importer, "");
      const out = await resolveNewUrlRef({ resolve: async () => null }, "./nope.wasm", importer);
      expect(out).toBeNull();
      expect(existsSync(join(dir, "nope.wasm"))).toBe(false);
    });
  });
});
