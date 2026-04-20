# Runtime Specification

## Signals
Uses `@preact/signals` for fine-grained reactivity.
* `signal(value)`: Creates a reactive piece of state.
* `effect(fn)`: Runs the function reactively when signals inside it change.

## Props Proxy
The `createPropsProxy(el)` function bridges the Web Component's attributes/properties with the functional component's expected `props` object:
* Accessing `props.label` first checks for a property on the element, then falls back to the internal `_propsSignals` (driven by `attributeChangedCallback`).

## Lifecycle (Compiler-only)
There is no runtime lifecycle module. The `onMount` and `onCleanup` functions are syntax sugar that the compiler maps to the native Web Component lifecycle methods (`connectedCallback` and `disconnectedCallback`).
