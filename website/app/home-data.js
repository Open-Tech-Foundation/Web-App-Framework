// Content for the landing page (app/page.jsx). Kept as data so the page stays a
// thin, declarative component and the capabilities/benchmark stay easy to keep
// truthful — every status here is checked against the actual codebase.

// --- Hero feature cards ------------------------------------------------------
export const features = [
  {
    icon: "⚡",
    title: "Zero-VDOM",
    desc: "No diffing, no reconciliation loop. State changes map straight to the DOM node that owns them.",
  },
  {
    icon: "🧩",
    title: "Native Components",
    desc: "Every component compiles to a standard Custom Element — interoperable with any library or tool.",
  },
  {
    icon: "🔋",
    title: "Signal Reactivity",
    desc: "$state, $derived, and $effect macros. The compiler wires fine-grained updates — no manual .value.",
  },
  {
    icon: "🛣️",
    title: "File-based Routing",
    desc: "Nested layouts, dynamic segments, catch-all paths, and route guards out of the box.",
  },
];

// --- Live demos: source + the REAL compiled output (from `otfwc`, lifecycle
//     boilerplate trimmed for readability — these are the calls it actually emits).
export const counterDemo = {
  code: `export default function Counter() {
  let count = $state(0);

  return (
    <div className="counter">
      <button onclick={() => count--}>-</button>
      <span>{count}</span>
      <button onclick={() => count++}>+</button>
    </div>
  );
}`,
  compiled: `import { signal, bindText } from "@opentf/web";

export class CounterElement extends HTMLElement {
  connectedCallback() {
    const count = signal(0);
    const el0 = document.createElement("div");
    el0.setAttribute("class", "counter");
    const el1 = document.createElement("button");
    el1.onclick = () => count.value--;
    el1.appendChild(document.createTextNode("-"));
    el0.appendChild(el1);
    const el2 = document.createElement("span");
    const t3 = document.createTextNode("");
    el2.appendChild(t3);
    bindText(t3, () => count.value);   // ← only this node updates
    el0.appendChild(el2);
    const el4 = document.createElement("button");
    el4.onclick = () => count.value++;
    el4.appendChild(document.createTextNode("+"));
    el0.appendChild(el4);
    this.appendChild(el0);
  }
}`,
};

export const todoDemo = {
  code: `export default function TodoList() {
  let todos = $state([{ id: 1, text: "Learn OTF Web", done: false }]);

  const toggle = (id) => {
    todos = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
  };

  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}>
          <input type="checkbox" checked={todo.done} onchange={() => toggle(todo.id)} />
          <span className={todo.done ? "done" : ""}>{todo.text}</span>
        </li>
      ))}
    </ul>
  );
}`,
  compiled: `import { signal, bindText, bindAttr, bindList } from "@opentf/web";

export class TodoListElement extends HTMLElement {
  connectedCallback() {
    const todos = signal([{ id: 1, text: "Learn OTF Web", done: false }]);
    const toggle = (id) =>
      todos.value = todos.value.map(t =>
        t.id === id ? { ...t, done: !t.done } : t);

    const el0 = document.createElement("ul");
    function default_item0(todo) {
      const li = document.createElement("li");
      const input = document.createElement("input");
      input.setAttribute("type", "checkbox");
      bindAttr(input, "checked", () => todo.value.done);
      input.onchange = () => toggle(todo.value.id);
      li.appendChild(input);
      const span = document.createElement("span");
      bindAttr(span, "class", () => todo.value.done ? "done" : "");
      const t = li.appendChild(span).appendChild(document.createTextNode(""));
      bindText(t, () => todo.value.text);
      return li;
    }
    // keyed list → minimal moves, per-item bindings update in place
    bindList(el0, () => todos.value, default_item0, todo => todo.id);
    this.appendChild(el0);
  }
}`,
};

// --- Benchmark (mirrors README / benchmarks/; indicative, frame-quantized) ---
const BENCH_ROWS = [
  { op: "create 1,000 rows", values: [83.4, 83.4, 83.2, 83.3] },
  { op: "create 10,000 rows", values: [716.8, 877.2, 718.1, 735.2] },
  { op: "append 1,000 rows", values: [66.8, 69.8, 66.6, 66.6] },
  { op: "update every 10th", values: [33.4, 28.8, 31.5, 33.4] },
  { op: "swap 2 rows", values: [33.3, 52.6, 33.3, 33.2] },
  { op: "select row", values: [36.2, 23.5, 33.3, 33.4] },
  { op: "remove row", values: [33.4, 23.9, 33.3, 33.3] },
  { op: "clear 10,000 rows", values: [50.1, 73.9, 49.1, 49.7] },
];

export const benchmark = {
  engines: ["otfw", "react", "solid", "svelte"],
  // `best` (column index of the fastest engine) is precomputed here so the page
  // can highlight it without a local inside a JSX `.map`.
  rows: BENCH_ROWS.map((r) => ({ ...r, best: r.values.indexOf(Math.min(...r.values)) })),
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
      { name: "Internationalization", status: "planned", desc: "Locale routing and message loading." },
      { name: "Accessibility helpers", status: "planned", desc: "ARIA helpers and a11y defaults." },
    ],
  },
];
