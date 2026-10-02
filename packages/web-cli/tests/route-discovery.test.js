import { expect, test } from "runtime:test";
import { makeTempDir, mkdir, remove, write } from "runtime:fs";
import { join } from "runtime:path";
import { discoverPages } from "../src/shared.js";

test("SSG discovery rejects nested Markdown 404 files and respects exclusions", async () => {
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "ssg-404-" });
  try {
    const app = join(scratch, "app");
    await mkdir(join(app, "docs"), { recursive: true });
    await write(join(app, "page.mdx"), "# Home");
    await write(join(app, "404.jsx"), "export default function Missing() {}");
    for (const extension of ["mdx", "md"]) {
      const path = join(app, "docs", `404.${extension}`);
      await write(path, "# Missing");
      await expect(discoverPages(app, new Set())).rejects.toThrow(
        `Unsupported Markdown 404 route: ${path}. Use 404.jsx or 404.tsx instead.`,
      );
      const pages = await discoverPages(app, new Set(["docs"]));
      expect(pages).toContain(join(app, "page.mdx"));
      expect(pages).toContain(join(app, "404.jsx"));
      expect(pages).not.toContain(path);
      await remove(path);
    }
  } finally {
    await remove(scratch, { recursive: true });
  }
});
