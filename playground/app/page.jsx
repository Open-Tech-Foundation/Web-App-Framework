// Home — the demo index. Every example in the playground is reachable from here
// as a card, so the top nav can stay minimal. Cards are <Link>s (SPA navigation).

import { Link } from "@opentf/web";

const demos = [
  { href: "/counter", title: "Counter", desc: "$state, $derived, $effect, lifecycle hooks", tag: "Reactivity" },
  { href: "/products", title: "Perf Benchmark", desc: "Keyed list reconciliation over 5,000 rows", tag: "Reactivity" },
  { href: "/context-demo", title: "Context API", desc: "Scoped provide / useContext with overrides", tag: "Reactivity" },
  { href: "/dnd-demo", title: "Drag & Drop", desc: "Native HTML5 drag events + keyed lists", tag: "Events" },
  { href: "/ref-demo", title: "Ref & Expose", desc: "$ref to elements + imperative $expose", tag: "Components" },
  { href: "/icons", title: "SVG Icons", desc: "SVG namespacing & dynamic attributes", tag: "Rendering" },
  { href: "/reconnect-demo", title: "Memory Leak", desc: "Effect cleanup on unmount", tag: "Lifecycle" },
  { href: "/router-test", title: "Router API", desc: "Programmatic navigation & route state", tag: "Routing" },
  { href: "/post/1", title: "Dynamic Route", desc: "[id] params via router.params", tag: "Routing" },
  { href: "/shop/clothing/shirts", title: "Catch-all Route", desc: "[...slug] segments", tag: "Routing" },
  { href: "/login", title: "Login", desc: "Form inputs & route guard", tag: "Routing" },
  { href: "/about", title: "About", desc: "A plain static page", tag: "Routing" },
];

export default function Home() {
  return (
    <div class="space-y-8">
      <header class="space-y-2">
        <h1 class="text-4xl font-black tracking-tight bg-gradient-to-r from-indigo-400 to-sky-400 bg-clip-text text-transparent">
          OpenTF Web
        </h1>
        <p class="text-slate-400">
          A fullstack framework with a from-scratch IR compiler and a signal-based
          runtime. Pick a demo to see the pipeline in action.
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {demos.map((d) => (
          <Link
            href={d.href}
            class="group block rounded-xl border border-slate-700 bg-slate-900/40 p-5 transition-colors hover:border-indigo-400 hover:bg-slate-900"
          >
            <div class="text-[10px] font-bold uppercase tracking-widest text-indigo-400">
              {d.tag}
            </div>
            <div class="mt-2 text-lg font-semibold text-white group-hover:text-indigo-300">
              {d.title}
            </div>
            <div class="mt-1 text-sm text-slate-400">{d.desc}</div>
            <div class="mt-3 font-mono text-xs text-slate-500">{d.href}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
