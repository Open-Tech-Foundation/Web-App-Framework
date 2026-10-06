// Release-only output work, after every target and prerender step has finished.
import { file, remove } from "runtime:fs";
import { join, resolve } from "runtime:path";
import { cwd, env } from "runtime:process";
import { exists, writeFile } from "./runtime.js";
import { discoverPages, loadConfig, resolveCompiler, runBlogFeed, runDocsSearchIndex, runLlmsFiles } from "./shared.js";
import { step } from "./reporter.js";

const REPORT = ".otfw-prerender.json";

/** Hand resolved render metadata to the finish hook without recompiling pages. */
export async function writePrerenderReport(outDir, result) {
  await writeFile(join(outDir, REPORT), JSON.stringify({ siteDescription: result.siteDescription ?? "" }));
}

/** esdev project plugin (release-only `finish` hook); output paths come from staging, never from config. */
export function siteOutputPlugin({ root = ".", target = "web", prerenderTarget, exclude = [] } = {}) {
  const siteRoot = resolve(cwd(), root);
  return {
    name: "otfw-site-output",
    finish: {
      async handler(targets) {
        const output = targets[target];
        if (!output) return;
        // A selected browser-only build has no prerender step and must not index CSR.
        if (prerenderTarget && !targets[prerenderTarget]) return;
        if (output.platform !== "browser") throw new Error(`Site output target "${target}" must be a browser target`);
        const siteDir = output.outDir;
        const reportPath = join(siteDir, REPORT);
        let siteDescription = "";
        if (await exists(reportPath)) {
          ({ siteDescription } = await file(reportPath).json());
          await remove(reportPath);
        } else if (prerenderTarget) {
          throw new Error(`Prerender target "${prerenderTarget}" must call writePrerenderReport(outDir, result)`);
        }
        const config = await loadConfig(siteRoot);
        const appDir = join(siteRoot, "app");
        const excluded = new Set([...exclude, ...(env.EXCLUDE_ROUTES ?? "").split(",").filter(Boolean)]);
        const baseUrl = String(config?.site?.url ?? "").replace(/\/+$/, "");
        if (config?.docs?.search?.provider === "otf") {
          const progress = step("Building search index");
          const { otfwc } = await resolveCompiler();
          const search = await runDocsSearchIndex(siteRoot, config, siteDir, otfwc);
          progress.done(`Search index — ${search?.pages ?? 0} page(s)`);
        }
        if (config?.blog) {
          const progress = step("Generating blog feeds");
          const feed = await runBlogFeed(siteRoot, appDir, config, siteDir, baseUrl, excluded);
          progress.done(feed ? `Blog feeds — ${feed.count} post(s) → ${feed.paths.join(", ")}` : "Blog feeds — skipped");
        }
        if (config?.docs || config?.blog) {
          const progress = step("Generating LLM context");
          const pages = await discoverPages(appDir, excluded);
          const llms = await runLlmsFiles(siteRoot, appDir, pages, config, siteDir, baseUrl, { siteDescription });
          progress.done(llms ? `LLM context — ${llms.paths.join(", ")}` : "LLM context — skipped");
        }
      },
    },
  };
}
