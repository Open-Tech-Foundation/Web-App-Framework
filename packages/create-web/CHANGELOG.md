# @opentf/create-web

## [Unreleased]

## [0.15.0] - 2026-07-08

### Added

- **SPA** project template (`templates/spa/`): browser-only starter — no API routes,
  middleware, loaders, or `serve` script. For static or client-rendered apps.
- **Fullstack** project template (`templates/fullstack/`): ships `app/_middleware.js`,
  `app/loader.js`, `app/api/hello/route.js`, and `otfw serve` — wired to a demo home page.

### Changed

- Replaced the single **App** (`bare`) template with **SPA** and **Fullstack**; the
  interactive prompt uses plain-language titles and descriptions
  (e.g. "SPA (browser-only)", "Fullstack (browser + server)").
- Template dependency floors updated to `@opentf/web@^0.16.0`, `@opentf/web-cli@^1.12.0`,
  `@opentf/web-docs@^0.12.0`, `@opentf/web-test@^1.11.0`, and `@opentf/web-compiler@^0.8.0`
  (still pinned to npm latest at scaffold time).
- TypeScript scaffolding renames `_middleware.js` and `loader.js` to `.ts` alongside API
  routes.

### Removed

- **`bare` template** — use **SPA** or **Fullstack** instead.

## [0.14.0] - 2026-07-06

### Changed

- Docs template (`otfw.config.js`): enable `lastUpdated: true` by default and add a
  `repoUrl` placeholder so new docs sites show per-page "Last updated" timestamps and
  "Edit this page" links once the repository URL is set.

## [0.13.0] - 2026-07-05

### Added

- All templates now ship a `jsconfig.json` with `jsx: "preserve"` and
  `jsxImportSource: "@opentf/web"` for editor JSX support. TypeScript projects get the
  same options in `tsconfig.json` instead.

## [0.12.0] - 2026-07-05

### Added

- The scaffolder now resolves every `@opentf/*` dependency in the generated `package.json`
  to `^<latest>` from the npm registry before writing any project files; scaffolding
  aborts atomically if npm is unreachable. Set `CREATE_WEB_SKIP_NPM=1` to skip resolution
  (local dev only).
- Isolated integration tests under `tests/scaffold.test.js` cover all templates, mock
  registry pinning, unreachable-registry failure, Tailwind styling, and library JS/TS
  scaffolding.
- After scaffolding, the tool runs `<pm> install` automatically using the package manager
  that invoked it (`npm`/`pnpm`/`yarn`/`bun` via `npm_config_user_agent`). Set
  `CREATE_WEB_SKIP_INSTALL=1` to skip (local dev/tests).
- **Library** project template: scaffolds a publishable component package that exports
  source `.jsx` from `index.js` (apps compile it via their `otfw` toolchain), ships a
  sample `Counter`, `bun test` with `@opentf/web-test`, and wires `otfwc` through
  `test-setup.js` + `@opentf/web-compiler`. TypeScript mode emits `.tsx` sources and
  `index.ts`. Next steps suggest `<pm> test` instead of `dev`.
- TypeScript project option: choose TypeScript at the prompt to scaffold `.tsx` pages,
  `.ts` API routes, `tsconfig.json`, macro typings (`app/otfw-env.d.ts`), and a
  `typescript` devDependency. Docs sites keep `otfw.config.js` and `_meta.js` (the
  toolchain reads those as JavaScript today).

## [0.11.0] - 2026-07-05

### Changed

- App template (`@opentf/web@^0.9.0`, `@opentf/web-cli@^1.4.0`): scaffolded apps ship with the hydration fixes — eager islands like `<Link>` adopt server DOM instead of double-wrapping it, and mid-hydration rebuilds no longer cascade mismatches through nested components.
- Docs template (`@opentf/web@^0.9.0`, `@opentf/web-docs@^0.5.0`, `@opentf/web-cli@^1.4.0`): scaffolded docs sites track the latest framework and docs packages, inheriting the same hydration improvements for SSG pages with nav, sidebar, and MDX content islands.

## [0.10.0] - 2026-07-05

### Changed

- App and docs templates (`@opentf/web-cli@^1.3.1`): scaffolded projects pick up the compiler fix for `onMount` inside SSG pages, so pre-rendered sites no longer crash on hydration.

## [0.9.0] - 2026-07-05

### Changed

- App template (`@opentf/web@^0.8.0`, `@opentf/web-cli@^1.3.0`): scaffolded apps ship with route loaders, an API-route server runtime, and full `otfw serve` / `--ssg` toolchain support for the bundled `/api/hello` example.
- Docs template (`@opentf/web@^0.8.0`, `@opentf/web-docs@^0.4.0`, `@opentf/web-cli@^1.3.0`): scaffolded docs sites use the latest MDX/docs toolchain and SSG builds with route-loader support and static `__data.json` for client navigation.

## [0.8.0] - 2026-07-05

### Added

- The app template now scaffolds an example API route (`app/api/hello/route.js`, a
  `GET /api/hello` endpoint) and a fetch demo on the home page, plus a `serve`
  script (`otfw serve`) to run the SSR + API server.
- Scaffolded projects now start with a `.gitignore` (node_modules, `dist/`, and the
  toolchain's working dirs like `.dev` / `.otfw-*`). Templates ship it as `_gitignore`
  — npm strips `.gitignore` files from packages — and the scaffolder renames it.

## [0.7.0] - 2026-07-04

### Changed

- Updated scaffolded template dependencies to `@opentf/web@^0.7.0`,
  `@opentf/web-cli@^1.2.0`, and `@opentf/web-docs@^0.3.0`.
- Simplified the app template to a single welcome page.
- Updated the docs template with a landing page plus a `/docs` section that shows the
  generated navbar, `_meta.js` sidebar ordering, and table of contents.
- Docs templates now scaffold `site.url: null` as an explicit production-build
  placeholder.
- Generated projects now keep the template's published package ranges when the
  scaffolder is run from this monorepo, instead of rewriting `@opentf/*`
  dependencies to local `file:` packages.

## [0.6.0] - 2026-07-01

### Added

- Documentation-site project template. `bun create @opentf/web` now prompts for a
  project type and can scaffold a docs site powered by `@opentf/web-docs` — navbar,
  sidebar nav, MDX pages, `global.css`, and a wired-up `otfw.config.js` — alongside the
  existing app template.

### Fixed

- The docs template's MDX pages import their doc components correctly.

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.

## 0.4.0

### Minor Changes

- c846f32: Bump the @opentf/web compiler package verion to v0.4.0

## 0.3.0

### Minor Changes

- c3067ab: Update core web pkg ver

## 0.2.1

### Patch Changes

- b624031: Fix Vite 8 / Rolldown compatibility in scaffolding templates and ensure proper JSX parsing by adding @babel/plugin-syntax-jsx to devDependencies.

## 0.2.0

### Minor Changes

- cc2f3d1: Fix scaffolding tool

## 0.1.0

### Minor Changes

- 6bbe13a: Fix syntax error
