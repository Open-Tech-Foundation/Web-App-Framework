// Build-time OTF Search indexing; called after prerendering by the finish plugin.

import { join } from "runtime:path";
import { Command } from "runtime:system";
import { otfwcPath } from "@opentf/web-compiler";

/**
 * Build the index from prerendered HTML using the unified native toolchain.
 * Published toolchains ship one otfwc binary; source checkouts build it
 * from `cargo build -p otfw_cli`.
 */
export async function indexWithOtfSearch({ siteDir, otfwc }) {
  const binary = otfwc || await otfwcPath();
  const out = new Command(binary, {
    args: ["docs", "index", siteDir, "--out", join(siteDir, "_search"), "--root", "main"],
    stdout: "piped",
    stderr: "piped",
    inheritEnv: true,
  });
  const result = await out.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr).trim() || "otfwc docs index failed");
  const message = new TextDecoder().decode(result.stderr);
  const indexed = /indexed\s+(\d+)\s+page/.exec(message);
  if (!indexed) throw new Error("otfwc docs index did not report an index. Install the updated @opentf/web-compiler containing the docs indexing command.");
  const pages = Number(indexed[1]);
  return { pages };
}
