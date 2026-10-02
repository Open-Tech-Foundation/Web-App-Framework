import { expect, test } from "runtime:test";
import { makeTempDir, mkdir, remove, write } from "runtime:fs";
import { join } from "runtime:path";
import { createOtfwRoutes } from "../routes.js";

test("loader patterns are isolated, watched and exported without server imports", async () => {
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "loader-routes-" });
  try {
    const app = join(scratch, "content");
    for (const route of ["", "posts/[id]", "docs/[...slug]", "ignored"]) {
      await mkdir(join(app, route), { recursive: true });
      await write(join(app, route, "loader.ts"), 'throw new Error("SERVER_ONLY_SECRET");');
    }
    const plugin = createOtfwRoutes({ appDir: "content", exclude: ["ignored"] });
    const resolved = await plugin.resolve.handler("@otfw/routes", join(scratch, "entry.js"));
    let loaded = await plugin.load.handler(resolved.id);
    expect(loaded.code).toContain('export const loaderRoutes = ["/","/docs/[...slug]","/posts/[id]"];');
    expect(loaded.code).not.toContain("loader.ts");
    expect(loaded.code).not.toContain("SERVER_ONLY_SECRET");
    expect(loaded.dependsOn).toContain(join(app, "posts/[id]/loader.ts"));
    expect(loaded.dependsOn).not.toContain(join(app, "ignored/loader.ts"));
    await remove(join(app, "posts/[id]/loader.ts"));
    loaded = await plugin.load.handler(resolved.id);
    expect(loaded.code).not.toContain("/posts/[id]");
    const other = join(scratch, "other/content");
    await mkdir(other, { recursive: true });
    const second = await plugin.resolve.handler("@otfw/routes", join(scratch, "other/entry.js"));
    expect((await plugin.load.handler(second.id)).code).toContain("export const loaderRoutes = [];");
  } finally {
    await remove(scratch, { recursive: true });
  }
});

test("route discovery rejects duplicate JS and TS loaders", async () => {
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "duplicate-loaders-" });
  try {
    await write(join(scratch, "loader.js"), "export default () => 1;");
    await write(join(scratch, "loader.ts"), "export default () => 2;");
    await expect(createOtfwRoutes().load.handler(`@otfw/routes:${scratch}`)).rejects.toThrow("Conflicting loaders for /");
  } finally {
    await remove(scratch, { recursive: true });
  }
});

test("leaf appDir resolves beside the importing entry and discovers its routes", async () => {
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "routes-" });
  try {
    const site = join(scratch, "site");
    const app = join(site, "app");
    await mkdir(join(app, "docs"), { recursive: true });
    await write(join(app, "page.jsx"), "export default function Home() {}");
    await write(join(app, "docs/page.jsx"), "export default function Docs() {}");
    const plugin = createOtfwRoutes();
    const resolved = await plugin.resolve.handler("@otfw/routes", join(site, "entry.js"));
    expect(resolved.id).toBe(`@otfw/routes:${app}`);
    expect(resolved.virtual).toBe(true);
    const loaded = await plugin.load.handler(resolved.id);
    expect(loaded.code).toContain('["/app/page.jsx"]');
    expect(loaded.code).toContain('["/app/docs/page.jsx"]');
    expect(loaded.dependsOn).toContain(join(app, "page.jsx"));
    expect(loaded.dependsOn).toContain(join(app, "docs/page.jsx"));
  } finally {
    await remove(scratch, { recursive: true });
  }
});

test("route discovery rejects Markdown 404 files but respects excluded directories", async () => {
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "routes-404-" });
  try {
    const app = join(scratch, "app");
    await mkdir(join(app, "ignored"), { recursive: true });
    await write(join(app, "page.mdx"), "# Home");
    await write(join(app, "404.tsx"), "export default function Missing() {}");
    const plugin = createOtfwRoutes({ appDir: app, exclude: ["ignored"] });
    for (const extension of ["mdx", "md"]) {
      const path = join(app, `404.${extension}`);
      await write(path, "# Missing");
      await expect(plugin.load.handler(`@otfw/routes:${app}`)).rejects.toThrow(
        `Unsupported Markdown 404 route: ${path}. Use 404.jsx or 404.tsx instead.`,
      );
      await remove(path);
      const nested = join(app, "ignored", `404.${extension}`);
      await write(nested, "# Ignored");
    }
    const loaded = await plugin.load.handler(`@otfw/routes:${app}`);
    expect(loaded.code).toContain('["/app/page.mdx"]');
    expect(loaded.code).toContain('["/app/404.tsx"]');
    expect(loaded.code).not.toContain("ignored");
  } finally {
    await remove(scratch, { recursive: true });
  }
});
