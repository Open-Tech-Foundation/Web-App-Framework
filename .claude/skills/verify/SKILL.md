---
name: verify
description: Build/launch/drive recipe for verifying compiler+runtime changes in a real browser via the playground app.
---

# Verifying framework changes end-to-end

## Build the compiler binary
The real compiler is the Rust crate; the npm `@opentf/web-compiler` just wraps the binary.

```bash
cargo build -p otfw_cli          # produces target/debug/otfwc
```

## Run the playground against local sources
The playground uses workspace deps (`@opentf/web`, `@opentf/web-cli`), so runtime changes
are picked up directly. Point the CLI at the locally built compiler with `OTFWC_BIN`:

```bash
cd playground
OTFWC_BIN=$REPO/target/debug/otfwc bun run dev   # port 3005
```

Gotchas:
- **Routes are scanned at server startup** — a route dir added while the server runs 404s;
  restart the server.
- Rebuilding `otfwc` requires a dev-server restart too (long-lived `otfwc serve` process).
- Add scratch routes under `playground/app/<name>/page.jsx` (+ sibling component files);
  delete them after verification.

## Drive it headless
No puppeteer/playwright in the repo. Raw CDP works well with Bun's WebSocket:

```bash
chromium --headless=new --remote-debugging-port=9222 --no-sandbox \
  --user-data-dir=$SCRATCH/profile about:blank &
# fetch http://localhost:9222/json → connect ws → Page.navigate / Runtime.evaluate /
# Emulation.setDeviceMetricsOverride / Page.captureScreenshot
```

- After `setDeviceMetricsOverride` or scrolls, **capture a screenshot to force a render
  frame** — observers (ResizeObserver/IntersectionObserver) and media queries only deliver
  on frames; then sleep ~400ms before reading state.
- `Runtime.enable` replays buffered console messages from earlier loads — filter by
  `executionContextId` or timestamps when asserting "no new errors".
- Push evidence into a `window.__hookLog` array from the scratch page and read it with
  `Runtime.evaluate` (`returnByValue: true`).
- SPA navigation for cleanup checks: click a layout `<Link>` anchor
  (`document.querySelector('a[href="/"]').click()`); plain anchors are not intercepted.

## Compile a single module directly
For error/warning surface checks (diagnostics print as `warning:` on stderr):

```bash
./target/debug/otfwc build [--component] [--stdin] file.jsx
```
