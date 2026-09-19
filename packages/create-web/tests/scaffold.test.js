import { afterAll, afterEach, beforeAll, describe, expect, test } from "runtime:test";
import { exists, file, makeTempDir, mkdir, remove } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { serve } from "runtime:http";

import {
  fetchLatestVersion,
  listOpentfDeps,
  pinOpentfDeps,
} from "../bin/resolve-deps.js";
import { detectPackageManager, devCommand, installCommand, testCommand } from "../bin/detect-pm.js";
import { scaffold } from "../bin/scaffold.js";

const pkgRoot = dirname(dirname(fromFileURL(import.meta.url)));
const templatesRoot = join(pkgRoot, "templates");
const tmpBase = join(pkgRoot, ".tmp-esdev-tests");
const savedRegistry = env.CREATE_WEB_NPM_REGISTRY;
const savedSkip = env.CREATE_WEB_SKIP_NPM;
const savedPm = env.CREATE_WEB_PM;
const savedUserAgent = env.npm_config_user_agent;

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

async function readTemplatePkg(template) {
  return JSON.parse(await file(join(templatesRoot, template, "package.json")).text());
}

function readText(path) {
  return file(path).text();
}

function makeTmpDir(label) {
  return makeTempDir({ dir: tmpBase, prefix: `${label}-` });
}

let mockServer = null;

beforeAll(async () => {
  if (await exists(tmpBase)) await remove(tmpBase, { recursive: true });
  await mkdir(tmpBase, { recursive: true });
});

afterEach(async () => {
  if (mockServer) {
    await mockServer.stop();
    mockServer = null;
  }
  if (savedRegistry === undefined) delete env.CREATE_WEB_NPM_REGISTRY;
  else env.CREATE_WEB_NPM_REGISTRY = savedRegistry;
  if (savedSkip === undefined) delete env.CREATE_WEB_SKIP_NPM;
  else env.CREATE_WEB_SKIP_NPM = savedSkip;
  if (savedPm === undefined) delete env.CREATE_WEB_PM;
  else env.CREATE_WEB_PM = savedPm;
  if (savedUserAgent === undefined) delete env.npm_config_user_agent;
  else env.npm_config_user_agent = savedUserAgent;
});

afterAll(async () => {
  if (await exists(tmpBase)) await remove(tmpBase, { recursive: true });
});

describe("detect-pm", () => {
  test("detects pnpm, yarn, bun, and npm from npm_config_user_agent", () => {
    env.npm_config_user_agent = "pnpm/9.12.0 npm/? node/v22.0.0";
    expect(detectPackageManager()).toBe("pnpm");
    env.npm_config_user_agent = "yarn/4.5.0 npm/? node/v22.0.0";
    expect(detectPackageManager()).toBe("yarn");
    env.npm_config_user_agent = "bun/1.3.12";
    expect(detectPackageManager()).toBe("bun");
    env.npm_config_user_agent = "npm/10.9.0 node/v22.0.0";
    expect(detectPackageManager()).toBe("npm");
  });

  test("CREATE_WEB_PM overrides detection for local testing", () => {
    env.npm_config_user_agent = "npm/10.9.0 node/v22.0.0";
    env.CREATE_WEB_PM = "pnpm";
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
    mockServer = serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/@opentf%2fweb/latest") {
          return Response.json({ version: "9.9.9" });
        }
        if (url.pathname === "/@opentf%2fweb-cli/latest") {
          return Response.json({ version: "8.8.8" });
        }
        return new Response("not found", { status: 404 });
    });
    env.CREATE_WEB_NPM_REGISTRY = `http://127.0.0.1:${(await mockServer.addr).port}`;

    const pkg = {
      dependencies: { "@opentf/web": "^0.1.0" },
      devDependencies: { "@opentf/web-cli": "^0.1.0" },
    };
    await pinOpentfDeps(pkg);
    expect(pkg.dependencies["@opentf/web"]).toBe("^9.9.9");
    expect(pkg.devDependencies["@opentf/web-cli"]).toBe("^8.8.8");
  });

  test("pinOpentfDeps throws when the registry is unreachable", async () => {
    env.CREATE_WEB_NPM_REGISTRY = "http://127.0.0.1:1";
    await expect(
      pinOpentfDeps({ dependencies: { "@opentf/web": "^0.1.0" } }),
    ).rejects.toThrow(/npm registry|fetch|ECONNREFUSED|connection|Unable to connect/i);
  });

  test("pinOpentfDeps throws when a package is missing from the registry", async () => {
    mockServer = serve(
      { hostname: "127.0.0.1", port: 0 },
      () => new Response("not found", { status: 404 }),
    );
    env.CREATE_WEB_NPM_REGISTRY = `http://127.0.0.1:${(await mockServer.addr).port}`;
    await expect(
      pinOpentfDeps({ dependencies: { "@opentf/web": "^0.1.0" } }),
    ).rejects.toThrow(/404/);
  });
});

describe("scaffold — spa template", () => {
  test("writes a client-first project with npm-latest @opentf/* versions", async () => {
    const dir = await makeTmpDir("spa");
    const templatePkg = await readTemplatePkg("spa");
    const templateRanges = opentfRanges(templatePkg);

    const { packageJson } = await scaffold({ template: "spa", targetDir: dir });

    expect(await exists(join(dir, "package.json"))).toBe(true);
    expect(await exists(join(dir, ".gitignore"))).toBe(true);
    expect(await exists(join(dir, "app/page.jsx"))).toBe(true);
    expect(await exists(join(dir, "app/api"))).toBe(false);
    expect(await exists(join(dir, "jsconfig.json"))).toBe(true);
    expect(packageJson.scripts).toBeUndefined();
    const jsconfig = JSON.parse(await readText(join(dir, "jsconfig.json"), "utf-8"));
    expect(jsconfig.compilerOptions.jsx).toBe("preserve");
    expect(jsconfig.compilerOptions.jsxImportSource).toBe("@opentf/web");
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
    const dir = await makeTmpDir("spa-tailwind");
    await scaffold({ template: "spa", targetDir: dir, styling: "tailwind" });
    const css = await readText(join(dir, "app/global.css"), "utf-8");
    expect(css.startsWith('@import "tailwindcss";\n\n')).toBe(true);
  });

  test("typescript option emits .tsx pages and tsconfig", async () => {
    const dir = await makeTmpDir("spa-ts");
    const { packageJson } = await scaffold({ template: "spa", targetDir: dir, typescript: true });

    expect(await exists(join(dir, "app/page.tsx"))).toBe(true);
    expect(await exists(join(dir, "app/layout.tsx"))).toBe(true);
    expect(await exists(join(dir, "app/page.jsx"))).toBe(false);
    expect(await exists(join(dir, "tsconfig.json"))).toBe(true);
    expect(await exists(join(dir, "jsconfig.json"))).toBe(false);
    expect(await exists(join(dir, "app/otfw-env.d.ts"))).toBe(true);
    expect(packageJson.devDependencies?.typescript).toBe("^5.8.0");

    const tsconfig = JSON.parse(await readText(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.jsx).toBe("preserve");
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("@opentf/web");

    const page = await readText(join(dir, "app/page.tsx"), "utf-8");
    expect(page).toContain("app/page.tsx");

    const layout = await readText(join(dir, "app/layout.tsx"), "utf-8");
    expect(layout).toContain("children: unknown");
  });
});

describe("scaffold — fullstack template", () => {
  test("writes middleware, loader, and API route without package scripts", async () => {
    const dir = await makeTmpDir("fullstack");
    const templatePkg = await readTemplatePkg("fullstack");
    const templateRanges = opentfRanges(templatePkg);

    const { packageJson } = await scaffold({ template: "fullstack", targetDir: dir });

    expect(await exists(join(dir, "app/_middleware.js"))).toBe(true);
    expect(await exists(join(dir, "app/loader.js"))).toBe(true);
    expect(await exists(join(dir, "app/api/hello/route.js"))).toBe(true);
    expect(packageJson.scripts).toBeUndefined();

    const generated = opentfRanges(packageJson);
    for (const name of Object.keys(templateRanges)) {
      const latest = await fetchLatestVersion(name);
      expect(generated[name]).toBe(`^${latest}`);
    }
  });

  test("typescript option renames server files to .ts", async () => {
    const dir = await makeTmpDir("fullstack-ts");
    await scaffold({ template: "fullstack", targetDir: dir, typescript: true });

    expect(await exists(join(dir, "app/_middleware.ts"))).toBe(true);
    expect(await exists(join(dir, "app/loader.ts"))).toBe(true);
    expect(await exists(join(dir, "app/api/hello/route.ts"))).toBe(true);
    expect(await exists(join(dir, "app/_middleware.js"))).toBe(false);
  });
});

describe("scaffold — docs template", () => {
  test("writes a docs site in isolated tmp with npm-latest @opentf/* versions", async () => {
    const dir = await makeTmpDir("docs");
    const templatePkg = await readTemplatePkg("docs");
    const templateRanges = opentfRanges(templatePkg);

    const { packageJson } = await scaffold({ template: "docs", targetDir: dir });

    expect(await exists(join(dir, "package.json"))).toBe(true);
    expect(await exists(join(dir, ".gitignore"))).toBe(true);
    expect(await exists(join(dir, "otfw.config.js"))).toBe(true);
    expect(await exists(join(dir, "app/docs/page.mdx"))).toBe(true);
    expect(await exists(join(dir, "app/docs/layout.jsx"))).toBe(true);
    expect(await exists(join(dir, "app/blog/page.jsx"))).toBe(false);
    const config = await readText(join(dir, "otfw.config.js"), "utf-8");
    expect(config).not.toContain("blog:");
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

  test("blog option adds demo blog files and config", async () => {
    const dir = await makeTmpDir("docs-blog");
    await scaffold({ template: "docs", targetDir: dir, blog: true });

    expect(await exists(join(dir, "app/blog/page.jsx"))).toBe(true);
    expect(await exists(join(dir, "app/blog/hello-world/page.mdx"))).toBe(true);
    const config = await readText(join(dir, "otfw.config.js"), "utf-8");
    expect(config).toContain("blog:");
    expect(config).toContain('label: "Blog"');
    expect(config).toContain('href: "/blog"');
    const blogIndex = await readText(join(dir, "app/blog/page.jsx"), "utf-8");
    expect(blogIndex).toContain("Demo only");
    const docsPage = await readText(join(dir, "app/docs/page.mdx"), "utf-8");
    expect(docsPage).toContain("## Blog (demo)");
  });

  test("typescript option emits .tsx layouts and keeps JS config/meta files", async () => {
    const dir = await makeTmpDir("docs-ts");
    const { packageJson } = await scaffold({ template: "docs", targetDir: dir, typescript: true });

    expect(await exists(join(dir, "app/page.tsx"))).toBe(true);
    expect(await exists(join(dir, "app/layout.tsx"))).toBe(true);
    expect(await exists(join(dir, "app/docs/layout.tsx"))).toBe(true);
    expect(await exists(join(dir, "otfw.config.js"))).toBe(true);
    expect(await exists(join(dir, "app/docs/_meta.js"))).toBe(true);
    expect(await exists(join(dir, "tsconfig.json"))).toBe(true);
    expect(packageJson.devDependencies?.typescript).toBe("^5.8.0");

    const tsconfig = JSON.parse(await readText(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.include).toContain("otfw.config.js");
  });
});

describe("scaffold — library template", () => {
  test("writes a publishable package with Counter, tests, and npm-latest deps", async () => {
    const dir = await makeTmpDir("library");
    const { packageJson } = await scaffold({ template: "library", targetDir: dir });

    expect(await exists(join(dir, "index.js"))).toBe(true);
    expect(await exists(join(dir, "src/Counter.jsx"))).toBe(true);
    expect(await exists(join(dir, "tests/counter.test.js"))).toBe(true);
    expect(await exists(join(dir, "bunfig.toml"))).toBe(true);
    expect(await exists(join(dir, "test-setup.js"))).toBe(true);
    expect(await exists(join(dir, "jsconfig.json"))).toBe(true);
    expect(await readText(join(dir, "bunfig.toml"), "utf-8")).toContain("./test-setup.js");
    expect(packageJson.peerDependencies?.["@opentf/web"]).toMatch(/^\^/);
    expect(packageJson.devDependencies?.["@opentf/web-test"]).toMatch(/^\^/);
    expect(packageJson.devDependencies?.["@opentf/web-compiler"]).toMatch(/^\^/);
    expect(packageJson.publishConfig?.access).toBe("public");
  });

  test("typescript option emits .tsx sources and index.ts export", async () => {
    const dir = await makeTmpDir("library-ts");
    const { packageJson } = await scaffold({ template: "library", targetDir: dir, typescript: true });

    expect(await exists(join(dir, "index.ts"))).toBe(true);
    expect(await exists(join(dir, "src/Counter.tsx"))).toBe(true);
    expect(await exists(join(dir, "tests/counter.test.js"))).toBe(true);
    expect(await readText(join(dir, "tests/counter.test.js"), "utf-8")).toContain(
      "../src/Counter.tsx",
    );
    expect(packageJson.exports?.["."]).toBe("./index.ts");
    expect(await exists(join(dir, "jsconfig.json"))).toBe(false);
    const tsconfig = JSON.parse(await readText(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("@opentf/web");
  });
});

describe("scaffold — npm failure", () => {
  test("does not leave a package.json with stale template ranges when npm fails", async () => {
    const dir = await makeTmpDir("spa-fail");
    env.CREATE_WEB_NPM_REGISTRY = "http://127.0.0.1:1";

    await expect(scaffold({ template: "spa", targetDir: dir })).rejects.toThrow();
    expect(await exists(join(dir, "package.json"))).toBe(false);
  });
});
