import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  fetchLatestVersion,
  listOpentfDeps,
  pinOpentfDeps,
} from "../bin/resolve-deps.js";
import { detectPackageManager, devCommand, installCommand, testCommand } from "../bin/detect-pm.js";
import { scaffold } from "../bin/scaffold.js";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const templatesRoot = join(pkgRoot, "templates");
const tmpBase = join(tmpdir(), `create-web-test-${process.pid}`);
const savedRegistry = process.env.CREATE_WEB_NPM_REGISTRY;
const savedSkip = process.env.CREATE_WEB_SKIP_NPM;
const savedPm = process.env.CREATE_WEB_PM;
const savedUserAgent = process.env.npm_config_user_agent;

/** @param {Record<string, unknown>} pkg */
function opentfRanges(pkg) {
  const out = {};
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps)) {
      if (name.startsWith("@opentf/")) out[name] = range;
    }
  }
  return out;
}

/** @param {string} range */
function caretVersion(range) {
  expect(range).toMatch(/^\^[\d.]+$/);
  return range.slice(1);
}

function readTemplatePkg(template) {
  return JSON.parse(readFileSync(join(templatesRoot, template, "package.json"), "utf-8"));
}

function makeTmpDir(label) {
  return mkdtempSync(join(tmpBase, `${label}-`));
}

let mockServer = null;

beforeAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });
});

afterEach(() => {
  if (mockServer) {
    mockServer.stop(true);
    mockServer = null;
  }
  if (savedRegistry === undefined) delete process.env.CREATE_WEB_NPM_REGISTRY;
  else process.env.CREATE_WEB_NPM_REGISTRY = savedRegistry;
  if (savedSkip === undefined) delete process.env.CREATE_WEB_SKIP_NPM;
  else process.env.CREATE_WEB_SKIP_NPM = savedSkip;
  if (savedPm === undefined) delete process.env.CREATE_WEB_PM;
  else process.env.CREATE_WEB_PM = savedPm;
  if (savedUserAgent === undefined) delete process.env.npm_config_user_agent;
  else process.env.npm_config_user_agent = savedUserAgent;
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("detect-pm", () => {
  test("detects pnpm, yarn, bun, and npm from npm_config_user_agent", () => {
    process.env.npm_config_user_agent = "pnpm/9.12.0 npm/? node/v22.0.0";
    expect(detectPackageManager()).toBe("pnpm");
    process.env.npm_config_user_agent = "yarn/4.5.0 npm/? node/v22.0.0";
    expect(detectPackageManager()).toBe("yarn");
    process.env.npm_config_user_agent = "bun/1.3.12";
    expect(detectPackageManager()).toBe("bun");
    process.env.npm_config_user_agent = "npm/10.9.0 node/v22.0.0";
    expect(detectPackageManager()).toBe("npm");
  });

  test("CREATE_WEB_PM overrides detection for local testing", () => {
    process.env.npm_config_user_agent = "npm/10.9.0 node/v22.0.0";
    process.env.CREATE_WEB_PM = "pnpm";
    expect(detectPackageManager()).toBe("pnpm");
  });

  test("installCommand, devCommand, and testCommand use the detected manager", () => {
    expect(installCommand("pnpm")).toBe("pnpm install");
    expect(devCommand("yarn")).toBe("yarn run dev");
    expect(testCommand("npm")).toBe("npm test");
    expect(testCommand("bun")).toBe("bun test");
  });
});

describe("resolve-deps", () => {
  test("listOpentfDeps collects scoped packages from dependencies and devDependencies", () => {
    const names = listOpentfDeps({
      dependencies: { "@opentf/web": "^0.0.0", lodash: "1" },
      devDependencies: { "@opentf/web-cli": "^0.0.0" },
    });
    expect(names.sort()).toEqual(["@opentf/web", "@opentf/web-cli"]);
  });

  test("pinOpentfDeps uses a mock registry and pins ^latest", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/@opentf%2fweb/latest") {
          return Response.json({ version: "9.9.9" });
        }
        if (url.pathname === "/@opentf%2fweb-cli/latest") {
          return Response.json({ version: "8.8.8" });
        }
        return new Response("not found", { status: 404 });
      },
    });
    process.env.CREATE_WEB_NPM_REGISTRY = `http://127.0.0.1:${mockServer.port}`;

    const pkg = {
      dependencies: { "@opentf/web": "^0.1.0" },
      devDependencies: { "@opentf/web-cli": "^0.1.0" },
    };
    await pinOpentfDeps(pkg);
    expect(pkg.dependencies["@opentf/web"]).toBe("^9.9.9");
    expect(pkg.devDependencies["@opentf/web-cli"]).toBe("^8.8.8");
  });

  test("pinOpentfDeps throws when the registry is unreachable", async () => {
    process.env.CREATE_WEB_NPM_REGISTRY = "http://127.0.0.1:1";
    await expect(
      pinOpentfDeps({ dependencies: { "@opentf/web": "^0.1.0" } }),
    ).rejects.toThrow(/npm registry|fetch|ECONNREFUSED|connection|Unable to connect/i);
  });

  test("pinOpentfDeps throws when a package is missing from the registry", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch: () => new Response("not found", { status: 404 }),
    });
    process.env.CREATE_WEB_NPM_REGISTRY = `http://127.0.0.1:${mockServer.port}`;
    await expect(
      pinOpentfDeps({ dependencies: { "@opentf/web": "^0.1.0" } }),
    ).rejects.toThrow(/404/);
  });
});

describe("scaffold — bare template", () => {
  test("writes a project in isolated tmp with npm-latest @opentf/* versions", async () => {
    const dir = makeTmpDir("bare");
    const templatePkg = readTemplatePkg("bare");
    const templateRanges = opentfRanges(templatePkg);

    const { packageJson } = await scaffold({ template: "bare", targetDir: dir });

    expect(existsSync(join(dir, "package.json"))).toBe(true);
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    expect(existsSync(join(dir, "app/page.jsx"))).toBe(true);
    expect(existsSync(join(dir, "app/api/hello/route.js"))).toBe(true);
    expect(packageJson.name).toBe(dir.split("/").pop());

    const generated = opentfRanges(packageJson);
    for (const name of Object.keys(templateRanges)) {
      const latest = await fetchLatestVersion(name);
      expect(generated[name]).toBe(`^${latest}`);
      if (templateRanges[name] !== `^${latest}`) {
        expect(generated[name]).not.toBe(templateRanges[name]);
      }
    }
  });

  test("prepends Tailwind import when styling is tailwind", async () => {
    const dir = makeTmpDir("bare-tailwind");
    await scaffold({ template: "bare", targetDir: dir, styling: "tailwind" });
    const css = readFileSync(join(dir, "app/global.css"), "utf-8");
    expect(css.startsWith('@import "tailwindcss";\n\n')).toBe(true);
  });

  test("typescript option emits .tsx pages, .ts API routes, and tsconfig", async () => {
    const dir = makeTmpDir("bare-ts");
    const { packageJson } = await scaffold({ template: "bare", targetDir: dir, typescript: true });

    expect(existsSync(join(dir, "app/page.tsx"))).toBe(true);
    expect(existsSync(join(dir, "app/layout.tsx"))).toBe(true);
    expect(existsSync(join(dir, "app/api/hello/route.ts"))).toBe(true);
    expect(existsSync(join(dir, "app/page.jsx"))).toBe(false);
    expect(existsSync(join(dir, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(dir, "app/otfw-env.d.ts"))).toBe(true);
    expect(packageJson.devDependencies?.typescript).toBe("^5.8.0");

    const page = readFileSync(join(dir, "app/page.tsx"), "utf-8");
    expect(page).toContain("app/page.tsx");
    expect(page).toContain("app/api/hello/route.ts");

    const layout = readFileSync(join(dir, "app/layout.tsx"), "utf-8");
    expect(layout).toContain("children: unknown");
  });
});

describe("scaffold — docs template", () => {
  test("writes a docs site in isolated tmp with npm-latest @opentf/* versions", async () => {
    const dir = makeTmpDir("docs");
    const templatePkg = readTemplatePkg("docs");
    const templateRanges = opentfRanges(templatePkg);

    const { packageJson } = await scaffold({ template: "docs", targetDir: dir });

    expect(existsSync(join(dir, "package.json"))).toBe(true);
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    expect(existsSync(join(dir, "otfw.config.js"))).toBe(true);
    expect(existsSync(join(dir, "app/docs/page.mdx"))).toBe(true);
    expect(existsSync(join(dir, "app/docs/layout.jsx"))).toBe(true);
    expect(packageJson.name).toBe(dir.split("/").pop());

    const generated = opentfRanges(packageJson);
    expect(Object.keys(generated).sort()).toEqual(
      ["@opentf/web", "@opentf/web-cli", "@opentf/web-docs"].sort(),
    );

    for (const name of Object.keys(templateRanges)) {
      const latest = await fetchLatestVersion(name);
      expect(generated[name]).toBe(`^${latest}`);
    }
  });

  test("typescript option emits .tsx layouts and keeps JS config/meta files", async () => {
    const dir = makeTmpDir("docs-ts");
    const { packageJson } = await scaffold({ template: "docs", targetDir: dir, typescript: true });

    expect(existsSync(join(dir, "app/page.tsx"))).toBe(true);
    expect(existsSync(join(dir, "app/layout.tsx"))).toBe(true);
    expect(existsSync(join(dir, "app/docs/layout.tsx"))).toBe(true);
    expect(existsSync(join(dir, "otfw.config.js"))).toBe(true);
    expect(existsSync(join(dir, "app/docs/_meta.js"))).toBe(true);
    expect(existsSync(join(dir, "tsconfig.json"))).toBe(true);
    expect(packageJson.devDependencies?.typescript).toBe("^5.8.0");

    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.include).toContain("otfw.config.js");
  });
});

describe("scaffold — library template", () => {
  test("writes a publishable package with Counter, tests, and npm-latest deps", async () => {
    const dir = makeTmpDir("library");
    const { packageJson } = await scaffold({ template: "library", targetDir: dir });

    expect(existsSync(join(dir, "index.js"))).toBe(true);
    expect(existsSync(join(dir, "src/Counter.jsx"))).toBe(true);
    expect(existsSync(join(dir, "tests/counter.test.js"))).toBe(true);
    expect(existsSync(join(dir, "bunfig.toml"))).toBe(true);
    expect(existsSync(join(dir, "test-setup.js"))).toBe(true);
    expect(readFileSync(join(dir, "bunfig.toml"), "utf-8")).toContain("./test-setup.js");
    expect(packageJson.peerDependencies?.["@opentf/web"]).toMatch(/^\^/);
    expect(packageJson.devDependencies?.["@opentf/web-test"]).toMatch(/^\^/);
    expect(packageJson.devDependencies?.["@opentf/web-compiler"]).toMatch(/^\^/);
    expect(packageJson.publishConfig?.access).toBe("public");
  });

  test("typescript option emits .tsx sources and index.ts export", async () => {
    const dir = makeTmpDir("library-ts");
    const { packageJson } = await scaffold({ template: "library", targetDir: dir, typescript: true });

    expect(existsSync(join(dir, "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src/Counter.tsx"))).toBe(true);
    expect(existsSync(join(dir, "tests/counter.test.js"))).toBe(true);
    expect(readFileSync(join(dir, "tests/counter.test.js"), "utf-8")).toContain(
      "../src/Counter.tsx",
    );
    expect(packageJson.exports?.["."]).toBe("./index.ts");
  });
});

describe("scaffold — npm failure", () => {
  test("does not leave a package.json with stale template ranges when npm fails", async () => {
    const dir = makeTmpDir("bare-fail");
    process.env.CREATE_WEB_NPM_REGISTRY = "http://127.0.0.1:1";

    await expect(scaffold({ template: "bare", targetDir: dir })).rejects.toThrow();
    expect(existsSync(join(dir, "package.json"))).toBe(false);
  });
});