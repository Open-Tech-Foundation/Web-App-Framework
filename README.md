<div align="center">

# OTF Web

[🌐 https://web.opentechf.org](https://web.opentechf.org/)

### The native-first fullstack framework for modern web apps.

JSX compiles to native DOM operations via a Rust compiler — no virtual DOM, no runtime diff.
Built on signals and standard Web Components.

</div>

---

> [!CAUTION]
> **Alpha.** APIs and architecture may change as we harden toward production.

## What it is

OTF Web is a fullstack web framework on a Rust foundation. A single compiler and
toolchain spans the entire application: JSX components, client-side rendering,
hydration, static generation (SSG), server-side rendering (SSR), and server
endpoints are all produced from one source. The compiler analyzes your JSX
statically and emits the exact DOM operations needed — there is no virtual DOM
and no reconciliation loop at all.

## Why it's different

The compiler derives several small, focused intermediate representations from the
same AST — View, Reactivity, Server, Route, Metadata — and each backend turns
those into code for a target (CSR, Hydrate, SSG, SSR, API). One source, many IRs,
many targets. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design.

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

This compiles to a standard Custom Element built from direct DOM operations.
`{count}` becomes a single binding wired to one signal, so updating `count`
touches exactly that text node and nothing else.

## Features

- **Signals** — `$state`, `$derived`, `$effect`, `$ref`; the compiler wires
  reactivity, so there's no manual `.value`.
- **Standard Web Components** — every component compiles to a native Custom
  Element. Use it anywhere, with any tool.
- **File-based routing** — nested layouts, dynamic segments, catch-all routes,
  and route guards.
- **Batteries included** — forms, testing, i18n, MDX docs, and a `create-web`
  scaffolder.

## Performance

The runtime is a rendering-layer comparison against the React, Solid, and
Svelte 5 libraries. It's an honest one — no single operation is fastest, and the
create-row ops are ties at this timing resolution. See the
[benchmarks page](https://web.opentechf.org/benchmarks) for the full tables,
methodology, and caveats. Reproduce locally with `bun run bench all`.

## Ecosystem

| Package | Purpose |
| --- | --- |
| [`@opentf/web`](packages/web) | Runtime — signals, DOM operations, router, SSG. |
| [`@opentf/web-cli`](packages/web-cli) | The `otfw` toolchain — dev server and production build. |
| [`@opentf/web-compiler`](packages/web-compiler) | The IR compiler (`otfwc`) — prebuilt binaries + host resolver. |
| [`@opentf/web-form`](packages/web-form) | Reactive forms with async validation. |
| [`@opentf/web-test`](packages/web-test) | Testing utilities for native components. |
| [`@opentf/web-docs`](packages/web-docs) | MDX documentation theme — sidebar, callouts, TOC. |
| [`@opentf/web-i18n`](packages/web-i18n) | Internationalization — ICU messages, Intl formatters, URL-prefix locale routing. |
| [`create-web`](packages/create-web) | Project scaffolder (`create @opentf/web`). |

## Repository map

| Path | What's here |
| --- | --- |
| `crates/` | The Rust compiler and toolchain — parsing, semantic analysis, IRs, codegen, the `otfwc` binary. |
| `packages/` | Published JS packages — runtime, toolchain, forms, testing, docs, i18n. |
| `website/` | This project's docs site and playground (deployed at web.opentechf.org). |
| `benchmarks/` | The js-framework-benchmark harness and aggregation scripts. |

## Documentation

Full guides, API reference, and a live playground at **[https://web.opentechf.org/docs](https://web.opentechf.org/docs)**.

## License

[MIT](LICENSE) © [Open Tech Foundation](https://github.com/Open-Tech-Foundation).
