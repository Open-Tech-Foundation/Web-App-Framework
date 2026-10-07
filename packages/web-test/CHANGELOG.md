# @opentf/web-test

## [Unreleased]

### Changed

- Requires esdev `>=0.17.0`, whose native DOM realm supports the APIs `userEvent`
  needs (an extensible `navigator` for the clipboard stub, text selection and
  `Selection`). `userEvent.setup()` workflows now run under `--dom` as well as
  `--browser`.

## [1.26.0] - 2026-10-06

### Added

- Publish TypeScript declarations for `render`, `RenderResult` (bound Testing
  Library queries plus `container` and `unmount`), `cleanup`, `userEvent` and the
  `./setup` entry. Strict TypeScript tests in esdev's SPA and library starters
  now typecheck.

### Changed

- Requires esdev `>=0.16.0`.

## [1.25.0] - 2026-10-03

_Dependency updates._

## [1.24.0] - 2026-10-01

### Changed

- Run setup through esdev's `runtime:test` with its native DOM or browser mode.
  Remove the Bun JSX plugin and happy-dom dependency; configure JSX compilation
  through `@opentf/esdev-plugin-web` instead. Requires esdev `>=0.14.0`.
- Export the setup and browser runner explicitly and limit published files to the
  supported test helpers.

### Fixed

- `render()` mounts compiled custom elements using their registered `.tag` and
  assigns props before connection. Page factories use the framework's mount scope
  and lifecycle.
- `unmount()` and automatic cleanup dispose factory lifecycle and reactive scopes,
  remove mounted containers, and safely handle repeated calls.
- Failed renders remove their temporary container, and setup reports a clear error
  when neither DOM nor browser mode is enabled.

## [1.23.0] - 2026-08-12

_Dependency updates._

## [1.22.0] - 2026-07-31

_Dependency updates._

## [1.21.0] - 2026-07-30

_Dependency updates._

## [1.20.0] - 2026-07-29

_Dependency updates._

## [1.19.0] - 2026-07-25

_Dependency updates._

## [1.18.0] - 2026-07-25

_Dependency updates._

## [1.17.0] - 2026-07-25

_Dependency updates._

## [1.16.0] - 2026-07-24

_Dependency updates._

## [1.15.0] - 2026-07-18

_Dependency updates._

## [1.14.0] - 2026-07-18

_Dependency updates._

## [1.13.0] - 2026-07-08

_Dependency updates._

## [1.12.0] - 2026-07-08

_Dependency updates._

## [1.11.0] - 2026-07-07

_Dependency updates._

## [1.10.0] - 2026-07-07

_Dependency updates._

## [1.9.0] - 2026-07-07

### Added

- `browser-runner.js` — a `bun:test`-compatible `describe`/`test`/`expect` shim
  (`toBe`/`toEqual`/`toContain`/`toBeNull`/`toThrow`/`toBeDefined` + `.not`) that collects
  tests in-page and runs them via `window.__run()`, so the hi-fi runtime suites can run
  unchanged inside a real headless browser.

## [1.8.0] - 2026-07-07

_Dependency updates._

## [1.7.0] - 2026-07-06

_Dependency updates._

## [1.6.0] - 2026-07-06

_Dependency updates._

## [1.5.0] - 2026-07-05

_Dependency updates._

## [1.4.0] - 2026-07-05

_Dependency updates._

## [1.3.0] - 2026-07-05

_Dependency updates._

## [1.2.0] - 2026-07-03

_Dependency updates._

## [1.1.0] - 2026-07-01

_Dependency updates._

## 1.0.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.

### Patch Changes

- Updated dependencies [bb1c71b]
  - @opentf/web@0.5.0
