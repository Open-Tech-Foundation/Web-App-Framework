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

A **rendering-layer** comparison: OTF Web's runtime against the React, Solid and Svelte 5
*libraries* — not Next.js, SolidStart or SvelteKit. The case is one page of reactive list
updates, so no router, build step or SSG code runs on any side. Standard
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) ops through one
shared harness, production builds, 4× CPU throttling; median ms pooled over 3 runs, lower is
better. Bold marks a margin above the ~8.3 ms timing resolution — most rows are ties.

| operation | otfw | react | solid | svelte |
| --- | --: | --: | --: | --: |
| create 1,000 rows | 261.1 | 274.1 | **244.3** | 257.6 |
| create 10,000 rows | 2627.8 | 3338.6 | 2542.2 | 2548.8 |
| append 1,000 to 1,000 | 295.8 | 286.1 | 270.1 | 267.4 |
| update every 10th (1k) | 91.8 | 93.8 | 108.9 | 92.5 |
| swap 2 rows (1k) | 33 | 246.4 | 31.1 | 31.3 |
| select row (1k) | 26.1 | 27.3 | 30 | 29 |
| remove row (1k) | 40.4 | 39.9 | 37.5 | 36.1 |
| clear 10,000 rows | 178.6 | 260.9 | 164 | 165.3 |

OTF Web leads no operation here: Solid takes `create 1,000 rows` and the other seven are
ties. It is well clear of React on `swap 2 rows` (33 vs 246) and `clear 10,000` (179 vs 261).

Reproduce with `bun run bench all` a few times, then `bun benchmarks/aggregate.mjs --latest 3`
— a single run's margins on the create rows are smaller than its own run-to-run drift, so the
fastest label there turns over between runs. See [methodology &amp; caveats](benchmarks/README.md).

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
