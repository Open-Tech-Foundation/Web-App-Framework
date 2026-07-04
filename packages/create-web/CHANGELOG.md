# @opentf/create-web

## [Unreleased]

### Added

- The app template now scaffolds an example API route (`app/api/hello/route.js`, a
  `GET /api/hello` endpoint) and a fetch demo on the home page, plus a `serve`
  script (`otfw serve`) to run the SSR + API server.

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
