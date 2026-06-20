# @opentf/web

The core engine of **OpenTF Web**, a lightweight, high-performance SPA framework designed for the modern web.

## Features

- 🚀 **Zero-VDOM**: Compiles JSX directly to imperative DOM operations for maximum speed.
- ⚡ **Signal-Based Reactivity**: Powered by `@preact/signals-core` for fine-grained, surgical updates.
- 📦 **Web Component Native**: Every component is a standard Custom Element, ensuring perfect encapsulation and interoperability.
- 🛠️ **Convention-over-Configuration**: File-based routing and automatic component registration.
- 📏 **Ultra-Lightweight**: Minimal runtime footprint.

## Installation

```bash
npm install @opentf/web
```

## Basic Usage

```jsx
export default function Counter() {
  let count = $state(0);
  const doubled = $derived(count * 2);

  return (
    <div className="counter">
      <button onclick={() => count--}>-</button>
      <span>{count} ({doubled})</span>
      <button onclick={() => count++}>+</button>
    </div>
  );
}
```

## Documentation

Visit [web.opentf.workers.dev](https://web.opentf.workers.dev) for full documentation and guides.

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
