import { expect, test } from "runtime:test";
import { makeTempDir, mkdir, remove, write } from "runtime:fs";
import { join } from "runtime:path";
import { createOtfwRoutes } from "../routes.js";

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
