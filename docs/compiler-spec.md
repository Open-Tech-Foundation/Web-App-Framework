# Compiler Specification

## Transformation Rules

1. **JSX to Imperative DOM**: Every JSX element is transformed into a series of `document.createElement`, `setAttribute`, and `appendChild` calls.
2. **Reactivity Injection**: Attributes and text nodes containing JSX expressions are wrapped in `effect()` calls from `@preact/signals`.
3. **Dynamic Children**: JSX expression containers in child positions are transformed into `renderDynamic(parent, () => expression)` calls.
4. **Nested JSX Transformation**: JSX elements found inside expression containers (e.g. in ternaries) are recursively transformed into IIFEs that return imperative DOM nodes.
5. **Macro Transformation**: `$state`, `$effect`, and `$derived` are replaced with `@preact/signals` primitives (`signal`, `effect`, `computed`) and imports are automatically added.
6. **Lifecycle Transformation**: `onMount` and `onCleanup` are collected from the top-level component/page body and wired into the generated `connectedCallback`/`disconnectedCallback` (components) or the page factory's `__lifecycle` record. The DOM hooks `onResize`, `onVisibilityChange`, and `onMediaQuery(query, cb)` are desugared to `ResizeObserver`/`IntersectionObserver`/`matchMedia` setup on the host element, with teardown (disconnect / listener removal) registered automatically.
7. **Prop Transformation**: Destructured parameters in components are converted to `props` object access (e.g. `name` -> `props.name`) to maintain reactivity.

## Component Architecture

### Web Components
* Each `.jsx` file (except `page.jsx`) is wrapped in a class extending `HTMLElement`.
* Props are mapped to `observedAttributes` and reactive setters.
* `connectedCallback` initializes the reactive setup.
* **Child Projection (Capture & Clear)**: Before rendering internal JSX, the framework captures all original `childNodes` into an internal `_children` property and clears the host element. This allows manual JSX projection using `{props.children}` to work correctly without being overwritten by automatic framework appending.

### Pages
* `page.jsx` exports a `render(root)` function.
* The content is appended directly to the provided root element.
