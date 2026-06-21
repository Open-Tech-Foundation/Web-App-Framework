#!/usr/bin/env bun
// `otfw` — the OTF Web toolchain CLI.
//
//   otfw dev     start the CSR dev server (watch + live-reload)
//   otfw build   produce a static production bundle in dist/
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
  default: {
    if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") {
      console.error(`unknown command: ${cmd}\n`);
    }
    console.log("otfw — OTF Web toolchain");
    console.log("usage:");
    console.log("  otfw dev     start the dev server");
    console.log("  otfw build   build for production (dist/); --ssg to pre-render routes");
    process.exit(cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h" ? 1 : 0);
  }
}
