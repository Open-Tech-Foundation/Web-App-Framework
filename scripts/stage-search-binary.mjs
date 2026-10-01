#!/usr/bin/env esdev
// Temporary second-binary staging until otf-release supports multiple binaries
// in one npm package. Run after its normal otfwc build/staging step.
import { exists, file, mkdir, write } from "runtime:fs";
import { join } from "runtime:path";
import { args } from "runtime:process";

const [triple, stageAs, ext = ""] = args;
if (!triple || !stageAs || !["", ".exe"].includes(ext)) {
  throw new Error("Usage: esdev scripts/stage-search-binary.mjs <triple> <stage_as> [ext]");
}

const stageDir = join(".artifacts", "@opentf/web-compiler", "bin", stageAs);
// Refuse an incomplete package: the release tool must stage the compiler first.
const compiler = join(stageDir, `otfwc${ext}.br`);
if (!(await exists(compiler))) throw new Error(`Compiler archive missing: ${compiler}`);
const source = join("target", triple, "release", `otf-search${ext}`);
// ES-Runtime's native Brotli stream; no external compressor or npm dependency.
const compressed = await new Response(
  new Blob([await file(source).bytes()]).stream().pipeThrough(new CompressionStream("brotli")),
).arrayBuffer();
await mkdir(stageDir, { recursive: true });
const destination = join(stageDir, `otf-search${ext}.br`);
await write(destination, new Uint8Array(compressed));
console.log(`Staged ${source} → ${destination}`);
