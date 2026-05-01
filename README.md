# Web App Framework

A project of the [Open Tech Foundation](https://github.com/Open-Tech-Foundation).

**[🚀 Try the Web App Framework Documentation & Playground](https://web.opentf.workers.dev/)**

> [!CAUTION]
> **EXPERIMENTAL PRE-RELEASE**
>
> Web App Framework is currently in an experimental, pre-release state. The framework architecture and APIs are subject to breaking changes as we optimize for production readiness.

## Overview

>**Web App Framework** is a modern, high-performance UI framework that compiles JSX directly into optimized, imperative native DOM operations. 

Unlike traditional frameworks, Web App Framework has **Zero-VDOM**. There is no Virtual DOM diffing or reconciliation loop. Instead, our compiler statically analyzes your components and generates the exact `document.createElement` and DOM property assignments needed. Every component you write is compiled into a **Standard Web Component**, ensuring perfect isolation and native performance.

## Key Features

- **Zero-VDOM Architecture**: Eliminate the overhead of Virtual DOM. Updates are direct and surgical.
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

## 📊 Performance Benchmarks

Web App Framework is designed for extreme performance in data-heavy applications. By bypassing the Virtual DOM, we aim for near-native speeds for large-scale DOM manipulations.

> [!NOTE]
> **Comprehensive Benchmarks Coming Soon.**
> We are currently preparing a standardized benchmark suite comparing Web App Framework against other major frameworks (React, Svelte, Solid) across rendering, memory usage, and update latency.

## License

This project is licensed under the [MIT License](LICENSE).
