# @opentf/web-cli

The **OTF Web** dev toolchain — the `otfw` command. A [Rolldown](https://rolldown.rs)-driven
CSR dev server, a production build, and static pre-rendering (SSG), with the IR
compiler ([`@opentf/web-compiler`](https://github.com/Open-Tech-Foundation/Web-App-Framework/tree/main/packages/web-compiler))
running as a transform plugin. Runs on [Bun](https://bun.sh).

## Installation

```bash
bun add -d @opentf/web-cli
```

It depends on `@opentf/web-compiler` (the prebuilt compiler binary) and expects
`@opentf/web` in your project. The fastest way to a working setup is
[`@opentf/create-web`](https://github.com/Open-Tech-Foundation/Web-App-Framework/tree/main/packages/create-web).

## Commands

The project root is the current working directory — its `index.html` plus a
file-based `app/` route tree (`page.jsx`, `layout.jsx`, `404.jsx`).

```bash
otfw dev            # start the dev server (watch + live reload)
otfw build          # production bundle in dist/ (hashed, code-split, minified)
otfw build --ssg    # build, then pre-render each static route to HTML
otfw serve          # build, then server-render each route per request (SSR)
```

- **`dev`** — bundles the route graph through Rolldown with the compiler as a
  transform, serves it, and live-reloads on change. Picks port 3000, scanning
  upward if it's taken; an explicit `--port` fails fast if busy.
- **`build`** — emits `dist/` from your `index.html`, compiling and hashing local
  stylesheets (TailwindCSS v4 supported out of the box).
- **`build --ssg`** — additionally pre-renders each route with `getStaticPaths`
  into static HTML.
- **`serve`** — builds `dist/`, then runs a per-request SSR server: assets are served
  from `dist/` and every navigation is server-rendered through the same path SSG uses.
  Picks port 3000 (scanning upward), or `--port` for an explicit one. Phase 1: the page
  becomes interactive via the client bundle (CSR mount); hydration is a later phase.

`OTFWC_BIN` overrides the compiler binary location. Published installs under
`node_modules` use the packaged compiler, even when the app lives inside a Cargo
workspace; this repository's own source checkout may build and use
`target/debug/otfwc` for compiler development.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
