#!/usr/bin/env esdev
// `otfw` — the OTF Web toolchain CLI.
//
//   otfw dev     start the CSR dev server (watch + live-reload)
//   otfw build   produce a static production bundle in dist/
//   otfw serve   build, then run the per-request SSR server
//
// The project root is the current working directory (its index.html + app/), like
// `vite` / `next` — or `--root=<dir>`, for a workspace that runs the toolchain from
// the repository root that contains both the CLI and the app.

import { args, exit } from "runtime:process";

const cmd = args[0];

// A build that fails is a fact about the project, not a crash in the toolchain, so it
// prints the diagnostics the bundler collected and stops. The JS stack behind them
// says only which of our own frames happened to be on top; `--trace` keeps it for the
// times the fault really is in here.
async function reportBuildFailure(err) {
  const { quiet } = await import("./reporter.js");
  quiet();
  const diagnostics = err?.errors ?? [];
  console.error("");
  for (const d of diagnostics) {
    // A plugin that failed said why in its own words, with its own code frame; the
    // bundler's `frame` for it is that same text behind a `[plugin]` banner, so the
    // message is the whole diagnostic and the frame would only repeat it.
    const wrapped = d.kind === "PLUGIN_ERROR";
    const where = d.id ? `${d.id}${d.line ? `:${d.line}:${d.column}` : ""}: ` : "";
    console.error(`✗ ${where}${wrapped ? unwrap(d.message) : d.message}`);
    if (d.frame && !wrapped) console.error(`\n${d.frame}`);
  }
  if (!diagnostics.length) console.error(`✗ ${err?.message ?? err}`);
  if (args.includes("--trace") && err?.stack) console.error(`\n${err.stack}`);
  exit(1);
}

// A plugin error arrives as `plugin \`otfw\` threw an error\n\nCaused by:\n    Error:
// <what happened, indented>\n        at <the bundler's own frames>`. Take the cause,
// undo the indent, and drop the stack: the frames are all inside the bundler, and
// what a compile error needs to say is the file, the line and the source.
function unwrap(message) {
  const caused = message.split(/\n\s*Caused by:\s*\n/)[1];
  if (!caused) return message;
  const lines = caused.replace(/^\s*[A-Za-z]*Error: /, "").split("\n");
  const end = lines.findIndex((l) => /^\s+at\s/.test(l));
  return (end === -1 ? lines : lines.slice(0, end))
    .map((l) => l.replace(/^ {4}/, ""))
    .join("\n")
    .trimEnd();
}

async function run(load) {
  try {
    await load();
  } catch (err) {
    if (err?.name !== "BuildError") throw err;
    await reportBuildFailure(err);
  }
}

switch (cmd) {
  case "dev": {
    const { runDev } = await import("./dev.js");
    await run(runDev);
    break;
  }
  case "build": {
    const { runBuild } = await import("./build.js");
    await run(runBuild);
    break;
  }
  case "serve": {
    const { runServe } = await import("./serve.js");
    await run(runServe);
    break;
  }
  default: {
    if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") {
      console.error(`unknown command: ${cmd}\n`);
    }
    console.log("otfw — OTF Web toolchain");
    console.log("usage:");
    console.log("  otfw dev     start the dev server");
    console.log("  otfw build   build for production (dist/); --ssg to pre-render routes");
    console.log("  otfw serve   build, then run the per-request SSR server (--port to override)");
    console.log("");
    console.log("  --root=<dir> act on that directory instead of the working directory");
    exit(cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h" ? 1 : 0);
  }
}
