// Content for the landing page (app/page.jsx). Kept as data so the page stays a
// thin, declarative component and the capabilities/benchmark stay easy to keep
// truthful — every status here is checked against the actual codebase.

import benchmarkReport from "./benchmark-report.json";

// --- Benchmark (generated) ---------------------------------------------------
// `bun run bench all` writes app/benchmark-report.json — medians, per-row winner,
// and the timing-resolution tie rule all come from the runner (see
// benchmarks/README.md for the methodology and its limits) — and the homepage
// renders that report as-is, so the table can't drift from the last recorded run.
export const benchmark = benchmarkReport;

// --- Capabilities & roadmap (grouped; statuses verified against the codebase) -
//     status: "supported" | "partial" | "beta" | "planned"
export const capabilities = [
  {
    category: "Core",
    items: [
      { name: "Client Rendering (CSR)", status: "supported", desc: "Compiler-driven SPA engine." },
      { name: "Zero-VDOM updates", status: "supported", desc: "Direct DOM operations, no diff." },
      { name: "Reactive macros", status: "supported", desc: "$state, $derived, $effect, $context on fine-grained signals." },
      { name: "Refs & expose", status: "supported", desc: "$ref to elements; imperative $expose." },
      { name: "Context API", status: "supported", desc: "Scoped DI with createContext, ContextProvider, and $context — no prop drilling." },
      { name: "Portal", status: "supported", desc: "Render a subtree into another DOM target; context resolves across the boundary." },
    ],
  },
  {
    category: "Routing",
    items: [
      { name: "File-based router", status: "supported", desc: "Directory routing with client-side navigation." },
      { name: "Nested layouts", status: "supported", desc: "Persistent UI across route changes." },
      { name: "Route guards", status: "supported", desc: "Protect routes with custom logic + redirects." },
      { name: "Code splitting", status: "supported", desc: "Per-route lazy chunks in `otfw build`; dev compiles a route on first visit." },
      { name: "Route prefetch", status: "planned", desc: "Preload route chunks on hover or when a link enters the viewport." },
    ],
  },
  {
    category: "Rendering",
    items: [
      { name: "Static generation (SSG)", status: "supported", desc: "Pre-render routes to HTML at build time." },
      { name: "MDX", status: "supported", desc: "MDX pages and components; docs theme included." },
      { name: "Server rendering (SSR)", status: "supported", desc: "Per-request HTML via otfw serve — the same render path as SSG." },
      { name: "Hydration", status: "supported", desc: "First paint adopts the server DOM — pages, layouts, lists, conditionals, and islands with rich props." },
    ],
  },
  {
    category: "Tooling & DX",
    items: [
      { name: "create-web scaffolder", status: "supported", desc: "App, Docs, or Library templates — JS/TS, auto-install, npm-pinned deps." },
      { name: "Dev server + reload on save", status: "partial", desc: "On-demand per-route compile. Edits under app/ rebuild and trigger a full-page refresh — not module-level HMR." },
      { name: "Module-level HMR", status: "planned", desc: "Hot-swap changed modules in place without reloading the tab." },
      { name: "Dev error overlay", status: "supported", desc: "In-browser error reporting during dev." },
      { name: "Testing library", status: "supported", desc: "Component testing utilities." },
      { name: "TypeScript / TSX", status: "beta", desc: "Scaffold .tsx projects with tsconfig and macro typings; full editor tooling in progress." },
      { name: "Devtools extension", status: "planned", desc: "Component, state, and network inspection." },
    ],
  },
  {
    category: "Styling",
    items: [
      { name: "Tailwind CSS", status: "supported", desc: "Compiled by the toolchain — no extra config." },
      { name: "Scoped CSS Modules", status: "supported", desc: "Component-scoped class names." },
    ],
  },
  {
    category: "Full-stack",
    items: [
      { name: "Middleware", status: "supported", desc: "app/_middleware.js gates pages, API routes, loader data, and SSR — context.locals shared downstream." },
      { name: "Cookie helpers", status: "supported", desc: "getCookie / setCookie / deleteCookie on @opentf/web/server — RFC 6265 helpers for middleware, API routes, and loaders." },
      { name: "Reactive forms", status: "beta", desc: "@opentf/web-form — porting to the new runtime." },
      { name: "API routes", status: "supported", desc: "File-based route.js / route.ts endpoints — standard Request/Response and dynamic params." },
      { name: "Data fetching", status: "supported", desc: "Route loaders (loader.js → router.data across SSR/SSG/SPA) + client-side resource(); queries and actions planned." },
      { name: "Internationalization", status: "beta", desc: "@opentf/web-i18n — URL-prefix locale routing, ICU messages, and Intl formatters (Phase 1)." },
      { name: "Accessibility helpers", status: "planned", desc: "ARIA helpers and a11y defaults." },
    ],
  },
];
