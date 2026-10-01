// Build-time OTF Search indexing; called after SSG until esdev output hooks land.

import { join } from "runtime:path";
import { Command } from "runtime:system";
import { otfSearchPath } from "@opentf/web-compiler";

/**
 * Build the binary index from prerendered HTML using the internal Rust indexer.
 * Published toolchains will ship the two binaries together; source checkouts get both
 * from `cargo build -p otfw_cli`.
 */
export async function indexWithOtfSearch({ siteDir, otfwc }) {
  const binary = await otfSearchPath({ otfwc });
  const out = new Command(binary, {
    args: ["build", siteDir, "--out", join(siteDir, "_search"), "--root", "main"],
    stdout: "piped",
    stderr: "piped",
    inheritEnv: true,
  });
  const result = await out.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr).trim() || "otf-search failed");
  const message = new TextDecoder().decode(result.stderr);
  const pages = Number(/indexed\s+(\d+)\s+page/.exec(message)?.[1] ?? 0);
  return { pages };
}
