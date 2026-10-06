# @opentf/web

The native-first **OTF Web** runtime — signal-based reactivity and zero-VDOM DOM
operations, paired with the IR-based compiler ([`@opentf/web-compiler`](https://github.com/Open-Tech-Foundation/Web-App-Framework/tree/main/packages/web-compiler)).

You normally don't call this API by hand. You write `.jsx` components; the compiler
lowers them to plain DOM code that imports its helpers (`signal`, `computed`,
`bindText`, `bindList`, …) from this package. Components compile to self-registering
`web-*` Custom Elements.

## Installation

```bash
pnpm add @opentf/web
```

Scaffold a ready-to-run app with [`esdev create`](https://esrun.opentechf.org/esdev/create)
and use `esdev start`, `esdev build`, and `esdev typecheck`.

## TypeScript

The package includes runtime declarations and JSX types. For `.tsx` sources, keep
JSX for the OTF compiler and select the framework's type entry:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentf/web",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true
  }
}
```

`esdev create my-app --language=ts` supplies the starter configuration and macro
declarations. `@opentf/web/jsx-runtime` is a type entry; component compilation
still runs through `@opentf/esdev-plugin-web`. Compiler helper signatures remain
permissive; signals and lifecycle callbacks carry their value and event types.

## What's inside

- **Reactivity** — a from-scratch `signal` / `computed` / `effect` core.
- **DOM runtime** — fine-grained bindings (`bindText`, `bindAttr`, `bindList`,
  `bindChild`, `setProp`, `spread`, `clsx`) the compiler targets, plus `Context`,
  `Portal`, `ErrorBoundary`, and event dispatch (`emit`).
- **Compiler macros** — authored in your components, resolved at compile time:
  `$state`, `$derived`, `$ref`, `$context`, `$effect`, `$expose`, and the
  `onMount` / `onCleanup` / `onResize` / `onVisibilityChange` / `onMediaQuery`
  lifecycle hooks.
- **`<Link>`** — client-side navigation, shipped as JSX source and compiled by your
  app's pipeline.

## Entry points

| Import | Contents |
| --- | --- |
| `@opentf/web` | runtime + reactivity + `Link` (what compiled components import) |
| `@opentf/web/signals` | the reactivity core on its own |
| `@opentf/web/runtime` | DOM helpers, Context, Portal, ErrorBoundary |
| `@opentf/web/server` | DOM-free SSR/SSG rendering, route registration and shared framework helpers |

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
