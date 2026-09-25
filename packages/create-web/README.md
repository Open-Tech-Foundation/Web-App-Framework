# @opentf/create-web

> **Deprecated — scaffold new projects with `esdev create` instead.**
>
> ```bash
> esdev create my-app
> ```
>
> `esdev create` ships the OTF templates (SPA, fullstack, docs, library) and
> replaces this package. See the
> [`esdev create` docs](https://esrun.opentechf.org/esdev/create). This package
> is kept for existing projects and will be removed in a future release.

The official scaffolding tool for **OTF Web**.

## Quick Start

Get a new project up and running in seconds. Install
[ES-Runtime](https://esrun.opentechf.org/) first; the toolchain runs on `esdev`.

```bash
pnpm create @opentf/web my-app
cd my-app
pnpm install
pnpm run dev
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
| **Library** | Publishable components with a browser test harness | Reusable UI package, not a runnable app |

`@opentf/*` dependencies in the generated `package.json` are pinned to the latest
published versions from npm at scaffold time.

## Usage

```bash
pnpm create @opentf/web my-cool-app
```

Follow the interactive prompts to choose a project type, language, and styling solution.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
