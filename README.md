<div align="center">

# OTF Web

### The native-first framework for modern web apps.

A high-performance, zero-VDOM framework that compiles JSX to native DOM.
Built with signals and standard Web Components.

[Documentation &amp; Playground](https://web.opentechf.org/) · [Open Tech Foundation](https://github.com/Open-Tech-Foundation) · [MIT License](LICENSE)

</div>

---

> [!CAUTION]
> **Alpha.** APIs and architecture may change as we harden toward production.

## Why OTF Web

- **Zero-VDOM** — no diffing, no reconciliation loop. The compiler statically analyzes your JSX and emits the exact `createElement` calls and DOM updates needed.
- **Standard Web Components** — every component compiles to a native Custom Element. Use it anywhere, with any tool.
- **Fine-grained signals** — `$state`, `$derived`, `$effect` macros; the compiler wires reactivity, so there's no manual `.value`.
- **File-based routing** — nested layouts, dynamic segments, catch-all routes, and route guards.
- **Batteries included** — forms, testing, MDX docs, and a `create-web` scaffolder (see [Ecosystem](#ecosystem)).

## Quick start

```bash
bun create @opentf/web my-app
cd my-app
bun install
bun run dev
```

`npm create @opentf/web@latest` and `pnpm create @opentf/web` work too.

## Example

```jsx
export default function Counter() {
  let count = $state(0);
  const doubled = $derived(count * 2); // no arrow needed — the compiler wraps it

  return (
    <div>
      <p>{count} × 2 = {doubled}</p>
      <button onclick={() => count++}>Increment</button>
    </div>
  );
}
```

This compiles to a standard Custom Element built from direct DOM operations — no
virtual DOM, no runtime diff. `{count}` becomes a single binding wired to one
signal, so updating `count` touches exactly that text node and nothing else.

### Reactive macros

| Macro | What it does |
| --- | --- |
| `$state(v)` | A reactive signal. The compiler handles `.value` for you, in logic and JSX. |
| `$derived(expr)` | A computed value. A bare expression (`$derived(a + b)`) is auto-wrapped. |
| `$effect(fn)` | Runs `fn` whenever its reactive dependencies change. |
| `$ref()` | Captures a reference to a DOM element. |

Any `{…}` containing reactive values is analyzed and wired for fine-grained
updates, so `{cond ? <A/> : <B/>}` reads like React but updates surgically.

## Performance

Standard [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) ops vs React, Solid, and Svelte 5 through one shared harness — run `bun run bench all` (median ms, lower is better):

| operation | otfw | react | solid | svelte |
| --- | --: | --: | --: | --: |
| create 1,000 rows | 83.4 | 83.4 | **83.2** | 83.3 |
| create 10,000 rows | **716.8** | 877.2 | 718.1 | 735.2 |
| append 1,000 to 1,000 | 66.8 | 69.8 | **66.6** | **66.6** |
| update every 10th (1k) | 33.4 | **28.8** | 31.5 | 33.4 |
| swap 2 rows (1k) | 33.3 | 52.6 | 33.3 | **33.2** |
| select row (1k) | 36.2 | **23.5** | 33.3 | 33.4 |
| remove row (1k) | 33.4 | **23.9** | 33.3 | 33.3 |
| clear 10,000 rows | 50.1 | 73.9 | **49.1** | 49.7 |

> Indicative only — a frame-quantized timer (~16.6 ms floor); see [methodology &amp; caveats](benchmarks/README.md).

## Ecosystem

| Package | Purpose |
| --- | --- |
| [`@opentf/web`](packages/web) | Runtime — signals, DOM operations, router, SSG. |
| [`@opentf/web-cli`](packages/web-cli) | The `otfw` toolchain — dev server and production build. |
| [`@opentf/web-form`](packages/web-form) | Reactive forms with async validation. |
| [`@opentf/web-test`](packages/web-test) | Testing utilities for native components. |
| [`@opentf/web-docs`](packages/web-docs) | MDX documentation theme — sidebar, callouts, TOC. |
| [`create-web`](packages/create-web) | Project scaffolder (`create @opentf/web`). |

## Documentation

Full guides, API reference, and a live playground at **[web.opentechf.org](https://web.opentechf.org/)**.

## License

[MIT](LICENSE) © [Open Tech Foundation](https://github.com/Open-Tech-Foundation).
