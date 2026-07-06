# Runtime Specification

## Signals
Uses `@preact/signals` for fine-grained reactivity.
* `signal(value)`: Creates a reactive piece of state.
* `effect(fn)`: Runs the function reactively when signals inside it change.

## Props Proxy
The `createPropsProxy(el)` function bridges the Web Component's attributes/properties with the functional component's expected `props` object:
* Accessing `props.label` first checks for a property on the element, then falls back to the internal `_propsSignals` (driven by `attributeChangedCallback`).

## Router Proxy
The `router` export is a reactive Proxy that wraps internal signals (`pathname`, `isGuarding`, etc.):
* **Auto-Unwrapping**: Accessing properties on the `router` proxy automatically returns the signal's value.
* **Internal Consistency**: Framework logic uses the raw `routerSignals` object to avoid Proxy-related TypeErrors during state updates.

## Lifecycle (Compiler-only)
There is no runtime lifecycle module. The `onMount` and `onCleanup` functions are syntax sugar that the compiler maps to the native Web Component lifecycle methods (`connectedCallback` and `disconnectedCallback`). The DOM hooks — `onResize`, `onVisibilityChange`, `onMediaQuery` — are likewise compiler-expanded, to `ResizeObserver`/`IntersectionObserver`/`matchMedia` setup on the host element with automatic teardown on disconnect. The `@opentf/web` exports of all five are SSR-safe no-op stubs.
