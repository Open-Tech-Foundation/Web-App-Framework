# @opentf/web-test

DOM testing utilities for OTF Web: mount compiled components or page factories,
query them with Testing Library, and tear down their lifecycle after each test.

## Installation

```bash
pnpm add -D @opentf/web-test @opentf/esdev-plugin-web
```

Install esdev 0.17 or newer. The test runner supplies the DOM; this package does
not install a replacement DOM or its own compiler plugin.

## Configuration

Create `esdev.test.json`:

```json
{
  "plugins": [{
    "module": "@opentf/esdev-plugin-web",
    "export": "createOtfwPlugin",
    "options": { "target": "csr", "failOnError": true }
  }],
  "test": { "setup": ["@opentf/web-test/setup"] }
}
```

The plugin compiles JSX imports. The per-file setup registers `afterEach(cleanup)`.
This follows esdev's [test configuration](https://esrun.opentechf.org/esdev/test/configuration).

## Usage

```js
import { expect, test } from "runtime:test";
import { render } from "@opentf/web-test";
import Counter from "./Counter.jsx";

test("increments", () => {
  const { getByRole } = render(Counter);
  const button = getByRole("button", { name: "Count: 0" });
  button.click();
  expect(button.textContent).toBe("Count: 1");
});
```

```bash
esdev test --config=esdev.test.json --dom
```

## User interactions

`userEvent` is re-exported from `@testing-library/user-event`. Its session,
typing, selection and keyboard workflows run in esdev's native DOM and in a real
browser:

```js
import { userEvent } from "@opentf/web-test";
const user = userEvent.setup();
await user.click(button);
await user.type(input, "Ada");
```

```bash
esdev test --config=esdev.test.json --dom       # fast native DOM
esdev test --config=esdev.test.json --browser   # real browser engine
```

Use `--browser` when a test depends on layout, CSS or real browser event timing.
Install a supported browser and its matching driver as described in
[esdev browser testing](https://esrun.opentechf.org/esdev/test/browser).

## API

- `render(Component, props = {})`: mounts a compiled component class using its
  registered `.tag`, a page factory, or a tag string. Props are assigned before
  connection. Returns `container`, `unmount()` and bound Testing Library queries.
- `unmount()`: tears down factory lifecycle and reactive scopes, removes the
  container, and lets custom-element disconnect run component cleanup. Repeated
  calls are safe.
- `cleanup()`: unmounts every view created by `render()`. The setup module calls
  it after each test; otherwise import `afterEach` from `runtime:test` and register
  `afterEach(cleanup)` yourself.
- `userEvent`: Testing Library's interaction API for browser tests.

DOM custom-element lifecycle reactions can settle asynchronously; await observable
cleanup effects when testing teardown.
