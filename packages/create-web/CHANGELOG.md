# @opentf/create-web

## [Unreleased]

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
