# @opentf/web-test

A testing utility for **OTF Web**, inspired by React Testing Library.

## Features

- **DOM Rendering**: Renders components into a virtual DOM (`happy-dom`).
- **Reactive Assertions**: Supports testing components that use signals and effects.
- **Compiler Integration**: Automatically transpiles JSX components using the framework's native compiler.
- **Testing Library Utilities**: Bundles `@testing-library/dom` for familiar querying.

## Installation

```bash
bun add -d @opentf/web-test
```

## Configuration

To enable automatic JSX compilation for tests, add a `bunfig.toml` to your package or root:

```toml
[test]
preload = ["@opentf/web-test/setup"]
```

## Usage

### Writing a Test

```jsx
import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import MyComponent from "./MyComponent.jsx";

describe("MyComponent", () => {
  test("reacts to clicks", async () => {
    const { getByTestId } = render(MyComponent);
    const user = userEvent.setup();
    const btn = getByTestId("btn");

    expect(btn.textContent).toBe("Count: 0");
    await user.click(btn);
    expect(btn.textContent).toBe("Count: 1");
  });
});
```

### API Reference

#### `render(Component, props = {})`
Renders a component into a container. Returns an object with:
- `container`: The DOM element containing the component.
- `unmount()`: A function to remove the component and trigger cleanup.
- ...all queries from `@testing-library/dom` (e.g., `getByTestId`, `queryByText`).

#### `cleanup()`
Removes all mounted components from the DOM. This is automatically called `afterEach` test if you use the recommended setup.
