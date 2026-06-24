import { Link } from "@opentf/web";
import InstallPill from "./components/InstallPill.jsx";
import { benchmark, capabilities } from "./home-data.js";

export const metadata = {
  title: "OTF Web — The native-first framework for modern web apps",
  description:
    "A high-performance, zero-VDOM framework that compiles JSX to native DOM. Built with signals and standard Web Components.",
  canonical: "/",
};

// Status pill styles, keyed by capability status. Theme-aware translucent fills.
const STATUS = {
  supported: {
    label: "Supported",
    cls: "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  },
  beta: {
    label: "Beta",
    cls: "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-600 border border-sky-500/20",
  },
  planned: {
    label: "Planned",
    cls: "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 border border-amber-500/20",
  },
};

export default function HomePage() {
  // Flatten the grouped capabilities to a single list (plain data — done here, not
  // inside JSX, so the render is one flat .map with no per-item locals).
  const caps = capabilities.flatMap((g) =>
    g.items.map((i) => ({ ...i, category: g.category })),
  );

  return (
    <div className="flex-1 max-w-6xl mx-auto px-8 w-full pb-24">
      {/* Hero */}
      <section className="hero-glow text-center max-w-3xl mx-auto py-28 space-y-7">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/25 rounded-full text-[11px] font-bold uppercase tracking-wider">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]"></span>
          </span>
          Alpha
        </div>

        <h1 className="text-5xl md:text-7xl font-black tracking-tight text-[var(--text-main)] leading-[1.05]">
          The <span className="text-[var(--accent)]">native-first</span> framework for modern web apps.
        </h1>

        <p className="text-xl text-[var(--text-muted)] leading-relaxed max-w-xl mx-auto">
          A high-performance, zero-VDOM framework that compiles JSX to native DOM.
          Built with signals and standard Web Components.
        </p>

        <div className="flex justify-center pt-2">
          <Link href="/docs" className="transition-all active:scale-95">
            <span className="inline-flex items-center justify-center gap-2 bg-[var(--text-main)] text-[var(--bg-main)] px-7 py-3 rounded-xl font-bold hover:opacity-90 shadow-lg">
              Get Started
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </Link>
        </div>

        <div className="flex justify-center pt-1">
          <InstallPill command="bun create @opentf/web my-app" />
        </div>
      </section>

      {/* Benchmark */}
      <section className="py-12 space-y-8">
        <div className="text-center space-y-3">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Fast where it counts.</h2>
          <p className="text-[var(--text-muted)] max-w-2xl mx-auto">
            The standard js-framework-benchmark operation set vs React, Solid, and Svelte 5 — one shared harness. Median ms, lower is better.
          </p>
        </div>

        <div className="max-w-3xl mx-auto bg-[var(--bg-main)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border)]">
                  <th className="px-6 py-3 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Operation</th>
                  <th className="px-4 py-3 text-xs font-bold text-[var(--accent)] uppercase tracking-widest text-right">otfw</th>
                  <th className="px-4 py-3 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest text-right">react</th>
                  <th className="px-4 py-3 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest text-right">solid</th>
                  <th className="px-4 py-3 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest text-right">svelte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {benchmark.rows.map((row) => (
                  <tr>
                    <td className="px-6 py-3 font-medium text-[var(--text-main)]">{row.op}</td>
                    <td className={row.best === 0 ? "px-4 py-3 text-right font-mono font-bold text-[var(--accent)]" : "px-4 py-3 text-right font-mono text-[var(--text-main)]"}>{row.values[0]}</td>
                    <td className={row.best === 1 ? "px-4 py-3 text-right font-mono font-bold text-[var(--text-main)]" : "px-4 py-3 text-right font-mono text-[var(--text-muted)]"}>{row.values[1]}</td>
                    <td className={row.best === 2 ? "px-4 py-3 text-right font-mono font-bold text-[var(--text-main)]" : "px-4 py-3 text-right font-mono text-[var(--text-muted)]"}>{row.values[2]}</td>
                    <td className={row.best === 3 ? "px-4 py-3 text-right font-mono font-bold text-[var(--text-main)]" : "px-4 py-3 text-right font-mono text-[var(--text-muted)]"}>{row.values[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-center text-xs text-[var(--text-muted)]">
          Indicative only — a frame-quantized timer (~16.6&nbsp;ms floor). Run it yourself: <span className="mono">bun run bench all</span>.
        </p>
      </section>

      {/* Capabilities & roadmap */}
      <section className="py-24 space-y-12">
        <div className="text-center space-y-3">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Capabilities &amp; roadmap</h2>
          <p className="text-[var(--text-muted)] max-w-2xl mx-auto">A transparent look at what ships today and what's next.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {caps.map((cap) => (
            <div className="p-5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl flex flex-col gap-2 transition-colors hover:border-[var(--accent)]/40">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-[var(--text-main)] leading-snug">{cap.name}</span>
                <span className={STATUS[cap.status].cls}>{STATUS[cap.status].label}</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">{cap.desc}</p>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] opacity-60 mt-1">{cap.category}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-12">
        <div className="max-w-4xl mx-auto text-center bg-[var(--bg-surface)] border border-[var(--border)] rounded-3xl px-8 py-16 space-y-6">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-[var(--text-main)]">Build something native-first.</h2>
          <p className="text-[var(--text-muted)] max-w-xl mx-auto">Scaffold a project in seconds and read the guides to go from zero to a compiled, signal-driven app.</p>
          <div className="flex justify-center gap-4 flex-wrap">
            <Link href="/docs" className="transition-all active:scale-95">
              <span className="inline-flex items-center gap-2 bg-[var(--text-main)] text-[var(--bg-main)] px-7 py-3 rounded-xl font-bold hover:opacity-90 shadow-lg">Read the docs</span>
            </Link>
            <a href="https://github.com/Open-Tech-Foundation/Web-App-Framework" target="_blank" className="transition-all active:scale-95">
              <span className="inline-flex items-center gap-2 bg-[var(--bg-main)] text-[var(--text-main)] border border-[var(--border)] px-7 py-3 rounded-xl font-bold hover:border-[var(--accent)]/40">View on GitHub</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
