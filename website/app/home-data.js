// Content for the landing page (app/page.jsx). Kept as data so the page stays a
// thin, declarative component and the capabilities/benchmark stay easy to keep
// truthful — every status here is checked against the actual codebase.

// --- Benchmark (mirrors README / benchmarks/; 2026-07-04 run) ----------------
// Median ms over 10–12 samples (5 for the 10k cases) under 4× CPU throttling,
// double-rAF timing, warm-up discarded, GC between samples — see
// benchmarks/README.md for the full methodology and its limits.
const BENCH_ROWS = [
  { op: "create 1,000 rows", values: [243.4, 278.7, 257.8, 258.6] },
  { op: "create 10,000 rows", values: [2808.3, 3389.7, 2516.3, 2463.6] },
  { op: "append 1,000 rows", values: [305.1, 304.6, 262.7, 257.5] },
  { op: "update every 10th", values: [93.9, 98.5, 121.0, 88.8] },
  { op: "swap 2 rows", values: [34.3, 254.4, 30.7, 31.3] },
  { op: "select row", values: [25.3, 27.6, 28.1, 29.0] },
  { op: "remove row", values: [38.0, 42.1, 41.5, 42.1] },
  { op: "clear 10,000 rows", values: [195.2, 260.7, 157.7, 162.4] },
];

// Double-rAF timing can't split medians closer than half a frame (~8.3 ms), so
// a row only gets a bolded winner beyond that margin — same rule as the runner.
const RESOLUTION_MS = 1000 / 60 / 2;

export const benchmark = {
  engines: ["otfw", "react", "solid", "svelte"],
  // `best` (column index of the fastest engine, or -1 for a within-resolution
  // tie) is precomputed here so the page can highlight it without a local
  // inside a JSX `.map`.
  rows: BENCH_ROWS.map((r) => {
    const sorted = [...r.values].sort((a, b) => a - b);
    const decisive = sorted[1] - sorted[0] > RESOLUTION_MS;
    return { ...r, best: decisive ? r.values.indexOf(sorted[0]) : -1 };
  }),
};

// --- Capabilities & roadmap (grouped; statuses verified against the codebase) -
//     status: "supported" | "beta" | "planned"
export const capabilities = [
  {
    category: "Core",
    items: [
      { name: "Client Rendering (CSR)", status: "supported", desc: "Compiler-driven SPA engine." },
      { name: "Zero-VDOM updates", status: "supported", desc: "Direct DOM operations, no diff." },
      { name: "Reactive macros", status: "supported", desc: "$state, $derived, $effect on fine-grained signals." },
      { name: "Refs & expose", status: "supported", desc: "$ref to elements; imperative $expose." },
    ],
  },
  {
    category: "Routing",
    items: [
      { name: "File-based router", status: "supported", desc: "Directory routing with client-side navigation." },
      { name: "Nested layouts", status: "supported", desc: "Persistent UI across route changes." },
      { name: "Route guards", status: "supported", desc: "Protect routes with custom logic + redirects." },
      { name: "Code splitting", status: "planned", desc: "Automatic per-route splitting and prefetch." },
      { name: "Middleware", status: "planned", desc: "Request processing and transformations." },
    ],
  },
  {
    category: "Rendering",
    items: [
      { name: "Static generation (SSG)", status: "supported", desc: "Pre-render routes to HTML at build time." },
      { name: "MDX", status: "supported", desc: "MDX pages and components; docs theme included." },
      { name: "Server rendering (SSR)", status: "planned", desc: "Per-request HTML for full-stack apps." },
      { name: "Hydration", status: "planned", desc: "Adopt server markup without re-rendering." },
    ],
  },
  {
    category: "Tooling & DX",
    items: [
      { name: "create-web scaffolder", status: "supported", desc: "Start a project with one command." },
      { name: "Dev server + live reload", status: "supported", desc: "Rebuild-on-save with a browser refresh." },
      { name: "Dev error overlay", status: "supported", desc: "In-browser error reporting during dev." },
      { name: "Testing library", status: "supported", desc: "Component testing utilities." },
      { name: "TypeScript / TSX", status: "beta", desc: "TSX parses today; full type tooling in progress." },
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
    category: "Full-stack roadmap",
    items: [
      { name: "Reactive forms", status: "beta", desc: "@opentf/web-form — porting to the new runtime." },
      { name: "API routes", status: "planned", desc: "Server endpoints in the same graph as the UI." },
      { name: "Data fetching", status: "planned", desc: "Loaders, queries, and actions." },
      { name: "Internationalization", status: "beta", desc: "@opentf/web-i18n — URL-prefix locale routing, ICU messages, and Intl formatters (Phase 1)." },
      { name: "Accessibility helpers", status: "planned", desc: "ARIA helpers and a11y defaults." },
    ],
  },
];
