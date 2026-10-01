# esdev migration status

Verified against the installed esdev 0.14.0 on 2026-10-01. Template files are
embedded in the esdev binary; updating this repo's plugin cannot change them.

## Working in this repository

- Site and playground development/builds use declarative esdev configs.
- The compiler plugin transforms JSX/TSX/MDX and returns source maps; esdev owns
  final bundling, CSS and map composition. Markdown maps currently target generated JSX.
- Rust, framework DOM tests and browser tests run through `tsr` and esdev.
- `@opentf/web-test/setup` registers native `runtime:test` cleanup. JSX compilation
  belongs to the esdev plugin, and the runner supplies the DOM.
- Native `web-test` coverage verifies rendering, props, role queries and teardown;
  real-browser coverage verifies the full Testing Library user-event workflow.
- The standalone plugin integration test builds browser/server targets from package
  files and verifies real HTTP API, middleware, loader and SSR requests.
- Release site builds prerender pages and generate OTF Search, feeds and LLM files.
  CI runs a release site build as well as unit and browser suites.

## Upstream starter fixes required

Reproduce with `esdev create <dir> --template=<name> --package-manager=pnpm
--no-install --yes`.

| Template | Observed output in esdev 0.14 | Required change |
| --- | --- | --- |
| `spa` | No esdev.json; otfw dev/build/build --ssg scripts; HTML lacks a module entry | Emit native config, OTF plugin dependency and a client entry that imports @otfw/routes and calls mountApp; use esdev scripts |
| `docs` | No esdev.json; otfw dev/build --ssg scripts | Emit client/config plus a release prerender target; use provider otf and index the prerendered output |
| `fullstack` | No esdev.json; otfw dev/build/serve scripts | Emit client and server targets, a Request/Response server entry, API/middleware/loader wiring, and native run/watch scripts |
| `library` | esdev test script, but no compiler/test config; test only checks source files | Configure CSR compilation with routes disabled and native DOM cleanup; test an imported, rendered component |

SPA/docs/fullstack currently request the retired @opentf/web-cli executable.
They need an upstream template change and a new esdev binary release, followed
by fresh-project build/start/preview/test checks against published packages.
The repo's standalone plugin test verifies package integration independently;
it does not claim those generated templates already work.

## Upstream DOM compatibility

In the native DOM of esdev 0.14:

- `userEvent.setup()` fails when it tries to define navigator.clipboard on the
  non-extensible navigator.
- `userEvent.type(input, text)` encounters a missing HTMLInputElement.select API.

Use native DOM actions for the fast tier and `esdev test --browser` for full
Testing Library interactions. Fix the native DOM APIs upstream before documenting
userEvent.setup as supported by --dom. Do not replace the runner's globals with
happy-dom or a local DOM implementation.

## Output hooks and development SSG

Until output hooks land, website/ssg.js runs from the existing target
`then: run`. It indexes staged HTML after prerendering, propagates indexing
failures, and skips prerender/indexing when no release staging directory exists.

Move orchestration into native plugin hooks once their upstream contract is
available. Verify both development and release builds: development must not run
release prerendering, and output indexing must finish before publication.

## Release handoff

The maintainer owns release.toml changes, package versions and publishing.
Release the updated compiler archives and the packages that consume them:
@opentf/web-compiler, @opentf/esdev-plugin-web, @opentf/web-cli,
@opentf/web-docs and @opentf/web-test.

The compiler package must include both otfwc and otf-search for every supported
platform. See [search/RELEASE.md](../packages/web-docs/search/RELEASE.md).
The new web-test setup removes the Bun preload and happy-dom dependency; migrate
consumers to esdev.test.json and runtime:test imports as documented in its README.

The deprecated create-web package remains compatibility source until removal;
it is not the location for new starter development.
