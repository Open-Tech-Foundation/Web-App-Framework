# WAF — Web Application Framework

A project of the [Open Tech Foundation](https://github.com/Open-Tech-Foundation).

**[🚀 Try the WAF Documentation & Playground](https://open-tech-foundation.github.io/waf/)**

> [!CAUTION]
> **EXPERIMENTAL PRE-RELEASE**
>
> WAF is currently in an experimental, pre-release state. The framework architecture and APIs are subject to breaking changes as we optimize for production readiness.

## Overview

>**WAF (Web Application Framework)** is a modern, high-performance UI framework that compiles JSX directly into optimized, imperative native DOM operations. 

Unlike traditional frameworks, WAF has **Zero-VDOM**. There is no Virtual DOM diffing or reconciliation loop. Instead, our compiler statically analyzes your components and generates the exact `document.createElement` and DOM property assignments needed. Every component you write is compiled into a **Standard Web Component**, ensuring perfect isolation and native performance.

## Key Features

- **Zero-VDOM Architecture**: Eliminate the overhead of Virtual DOM. Updates are direct and surgical.
- **Native Web Components**: Your components are standard Custom Elements, compatible with any library or tool.
- **Reactive Macros**: Use `$state`, `$derived`, and `$effect` for powerful, declarative reactivity.
- **Boilerplate-Free**: No manual `.value` access. The compiler automatically injects reactivity where needed.
- **File-based Routing**: Intuitive routing with layouts and dynamic segments.
- **Declarative Refs**: Capture DOM nodes effortlessly with the `$ref` macro.

## Example

```jsx
export default function Counter() {
  const count = $state(0);
  const doubled = $derived(() => count * 2);

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

## 📊 Performance Benchmarks

WAF is designed for extreme performance in data-heavy applications. By bypassing the Virtual DOM, we aim for near-native speeds for large-scale DOM manipulations.

> [!NOTE]
> **Comprehensive Benchmarks Coming Soon.**
> We are currently preparing a standardized benchmark suite comparing WAF against other major frameworks (React, Svelte, Solid) across rendering, memory usage, and update latency.

## License

This project is licensed under the [MIT License](LICENSE).
