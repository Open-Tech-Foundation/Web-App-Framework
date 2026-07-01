# @opentf/web

## [Unreleased]

## [0.6.0] - 2026-07-01

### Added

- Navigation mode (`docs/HYDRATION.md` §7): `mountApp({ nav })` selects `"spa"` (default —
  the client router intercepts same-origin `<Link>` clicks for reload-free navigation) or
  `"mpa"` (every navigation is a full page load; each page hydrates its own first paint).
  MPA is the always-available substrate — `nav` only toggles the SPA enhancement, and in
  MPA mode the router skips the `popstate` listener. `<Link reload>` is a per-link escape
  hatch that forces a full navigation even in SPA mode. `shouldInterceptNav()` exposes the
  current mode to `<Link>`.
- Router first-paint hydration boot switch (Phase 2.0 — see `docs/HYDRATION.md` §3.4):
  `mountApp` detects the server sentinel `data-otfw-hydrate` on the root and, when the
  route module exposes a `hydrate` adopt factory, the router calls it to *adopt* the
  server-rendered DOM instead of `replaceChildren()` + rebuild. Only leaf routes (no
  layout chain) hydrate so far; a missing `hydrate` export, a layout chain, or a thrown
  mismatch (reported via `reportError`, never silent) falls through to a clean CSR build.
  `mountApp` now returns the initial navigation promise.
- Hydration primitives (`runtime/hydrate.js`, Phase 2 foundation — see
  `docs/HYDRATION.md`): a cursor walk that adopts the server DOM instead of rebuilding
  it — `cursor`, `claimElement`, `claimText` (the `<!--$-->…<!--/-->` text-hole scheme),
  `skipNode`, the `isHydrating` / `runHydration` flag, and `HydrationMismatch`. Reactivity
  still wires through the existing `bindText`/`bindAttr`; only node acquisition is new.
  Inert until the Hydrate codegen and client-boot switch consume it.
- `renderRoute` now returns an HTTP `status` alongside `{ html, metadata }`: `200` when
  the path matched a real route, `404` when it fell back to the registered 404 page. The
  new `otfw serve` SSR server uses it to set the response status; SSG ignores it (the
  field is additive, so existing `{ html, metadata }` destructuring is unaffected).
- `web-internal-code-block` built-in (emitted by the MDX front-end as `<CodeFence>`):
  renders a trusted, build-time-highlighted code block like `RawHtml`, but **wires its
  own copy button** on connect. So a code block's copy action works wherever it's
  rendered, with no delegated listener in an ancestor layout. SSG renders the markup
  inline; the behavior wires when the element upgrades in the browser.
- `copyText(text)` and `copyWithFeedback(button, text)` clipboard helpers (async
  Clipboard API with an `execCommand` fallback for non-secure contexts).

## 0.5.0

### Minor Changes

- bb1c71b: Upgrade to new architecuture.
