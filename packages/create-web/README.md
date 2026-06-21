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

- 🏗️ **Instant Scaffolding**: A ready-to-run OTF Web app — `index.html` + file-based
  `app/` routes, no config.
- 🎨 **Styling choice**: Plain CSS, or TailwindCSS v4 compiled by the toolchain (no
  extra config).
- ⚡ **OpenTF toolchain**: `otfw dev` (Rolldown-driven dev server with live reload),
  `otfw build`, and `otfw build --ssg` (static pre-render) — powered by the IR
  compiler.

## Usage

```bash
bun create @opentf/web@latest my-cool-app
```

Follow the interactive prompts to choose a styling solution. The generated project
has `dev`, `build`, and `build:ssg` scripts.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
