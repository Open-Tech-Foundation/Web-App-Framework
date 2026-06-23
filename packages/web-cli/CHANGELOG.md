# @opentf/web-cli

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The `[Unreleased]` section is renamed to the new version number at release time.

## [Unreleased]

### Fixed

- Dev server now serves `public/` assets (e.g. `/logo.png`), falling back to the
  `public/` directory the build copies to the dist root — so they no longer 404 in
  development.

## 1.0.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.

### Patch Changes

- Updated dependencies [bb1c71b]
  - @opentf/web@0.5.0
  - @opentf/web-compiler@0.1.0
