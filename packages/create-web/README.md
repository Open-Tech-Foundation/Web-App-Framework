# @opentf/create-web

The official scaffolding tool for **OTF Web**.

## Quick Start

Get a new project up and running in seconds (the toolchain runs on [Bun](https://bun.sh)):

```bash
bun create @opentf/web@latest my-app
cd my-app
bun install
bun run dev
```

## Features

- 🏗️ **Instant Scaffolding**: SPA, fullstack app, MDX docs site, or component library.
- 🔌 **Fullstack template**: `app/_middleware.js`, `app/loader.js`, and `app/api/hello/route.js`
  wired to a demo on the home page — plus `otfw serve` for SSR.
- 🎨 **Styling choice**: Plain CSS, or TailwindCSS v4 compiled by the toolchain (no
  extra config).
- ⚡ **OpenTF toolchain**: `otfw dev` (Rolldown-driven dev server with live reload),
  `otfw build`, `otfw build --ssg` (static pre-render), and `otfw serve` (SSR +
  API routes) — powered by the IR compiler.

## Project types

| Template | What it is | Pick when… |
| --- | --- | --- |
| **SPA (browser-only)** | UI runs in the browser; static deploy — no server files | No backend in the repo (or you call an external API) |
| **Fullstack (browser + server)** | UI + middleware, API routes, loaders, and `otfw serve` | You need auth, a database, or server-only logic |
| **Documentation site** | MDX docs/blog with `@opentf/web-docs` | Product docs or a content site |
| **Library** | Publishable components with `bun test` | Reusable UI package, not a runnable app |

`@opentf/*` dependencies in the generated `package.json` are pinned to the latest
published versions from npm at scaffold time.

## Usage

```bash
bun create @opentf/web@latest my-cool-app
```

Follow the interactive prompts to choose a project type, language, and styling solution.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)