#!/usr/bin/env bun
// `otfw` — the OTF Web toolchain CLI.
//
//   otfw dev     start the CSR dev server (watch + live-reload)
//   otfw build   produce a static production bundle in dist/
//   otfw serve   build, then run the per-request SSR server
//
// The project root is the current working directory (its index.html + app/),
// like `vite` / `next`.

const cmd = process.argv[2];

switch (cmd) {
  case "dev": {
    const { runDev } = await import("./dev.js");
    await runDev();
    break;
  }
  case "build": {
    const { runBuild } = await import("./build.js");
    await runBuild();
    break;
  }
  case "serve": {
    const { runServe } = await import("./serve.js");
    await runServe();
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
    process.exit(cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h" ? 1 : 0);
  }
}
