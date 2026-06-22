# The native-first framework for modern web apps.

A project of the [Open Tech Foundation](https://github.com/Open-Tech-Foundation).

**[🚀 Try the OTF Web Documentation & Playground](https://web.opentechf.org/)**

> [!CAUTION]
> **EXPERIMENTAL PRE-RELEASE**
>
> This framework is currently in an experimental, pre-release state. The architecture and APIs are subject to breaking changes as we optimize for production readiness.

## Overview

>**OTF Web** is a native-first UI framework that compiles JSX directly into imperative DOM operations.

Unlike traditional frameworks, OTF Web has **Zero-VDOM**. There is no Virtual DOM diffing or reconciliation loop. Instead, our compiler statically analyzes your components and generates the exact `document.createElement` and DOM property assignments needed. Every component you write is compiled into a **Standard Web Component**, ensuring isolation and direct DOM updates.

## Key Features

- **Zero-VDOM Architecture**: No Virtual DOM diffing or reconciliation loop — updates are compiled into direct DOM operations.
- **Native Web Components**: Your components are standard Custom Elements, compatible with any library or tool.
- **Reactive Macros**: Use `$state`, `$derived`, and `$effect` for powerful, declarative reactivity.
- **Boilerplate-Free**: No manual `.value` access. The compiler automatically injects reactivity where needed.
- **File-based Routing**: Intuitive routing with layouts and dynamic segments.
- **Declarative Refs**: Capture DOM nodes effortlessly with the `$ref` macro.
- **Official Ecosystem**: Standardized libraries for forms (`@opentf/web-form`) and testing (`@opentf/web-test`).

## Example

```jsx
export default function Counter() {
  const count = $state(0);
  const doubled = $derived(count * 2); // No arrow function needed!

  return (
    <div className="counter-card">
      <h1>Count: {count}</h1>
      <p>Doubled: {doubled}</p>
      <button onclick={() => count++}>
        Increment
      </button>
    </div>
  );
}
```

### Reactive Macros

The framework uses a set of compiler macros to provide a "no-boilerplate" reactivity experience.

#### `$state(initialValue)`
Transforms into a reactive Signal. The compiler automatically handles `.value` access for you in both logic and JSX.

#### `$derived(expression)`
Transforms into a Signal-based computed value. 
- **Auto-wrapping**: If you pass a direct expression (e.g., `$derived(a + b)`), the compiler automatically wraps it in an arrow function so you don't have to.

#### JSX Expressions
The compiler automatically analyzes expressions inside `{}`. If they contain reactive variables (`$state`, `$derived`, `props`), they are automatically wrapped in a dynamic update call. This allows standard React-style conditional rendering:
```jsx
// Just like React, but reactively efficient!
<div>{activeTab === "basic" ? <Basic /> : <Complex />}</div>
```

#### `$effect(callback)`
Runs a side effect whenever its reactive dependencies change.

#### `$ref()`
Captures a reference to a DOM element directly.

## 📊 Performance

OTF Web includes a benchmark suite ([`benchmarks/`](benchmarks/)) that implements
the standard [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
operation set against **React**, **Solid**, and **Svelte 5** through a single
shared harness. Run it yourself:

```bash
bun run bench all
```

**Where things stand (indicative, not yet a published claim).** On bulk creation
(10,000 rows) OTF Web is currently the fastest of the four. On most other
operations it sits at rough parity with React/Solid/Svelte, and on some
single-row updates the fine-grained frameworks are presently a frame ahead — an
area we are actively improving. These figures use a frame-quantized timer that
cannot resolve sub-frame differences, so they are **directional, not a
head-to-head ranking**. See the [methodology and caveats](benchmarks/README.md).

We will publish definitive numbers once tracing-based timing lands. Until then we
treat performance as a work in progress and would rather under-claim it than
overstate it.

## License

This project is licensed under the [MIT License](LICENSE).
