// The full benchmark story. The homepage carries only the two tables and a one-line
// framing each; everything a reader needs to judge those numbers — what is and is not
// being compared, the methodology, and the caveats that qualify each figure — lives
// here, so the landing page stays scannable without the claims losing their context.
import { benchmark, ssgBenchmark } from "../home-data.js";
import BenchmarkTable from "../components/BenchmarkTable.jsx";

export const metadata = {
  title: "Benchmarks",
  description:
    "How OTF Web is measured: a rendering-layer comparison against the React, Solid and Svelte libraries, and a framework-level build-cost comparison against Astro, Next.js, TanStack Start and Vite.",
  canonical: "/benchmarks",
};

const H2 = "text-2xl font-bold tracking-tight text-[var(--text-main)] mt-16 mb-3";
const H3 = "text-lg font-bold text-[var(--text-main)] mt-8 mb-2";
const P = "text-[var(--text-muted)] leading-relaxed mb-4 max-w-3xl";
const CARD =
  "max-w-3xl bg-[var(--bg-main)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm my-6";
const NOTE =
  "max-w-3xl border-l-2 border-[var(--accent)]/40 pl-4 my-6 text-sm text-[var(--text-muted)] leading-relaxed";
const A = "text-[var(--accent)] underline";

export default function Benchmarks() {
  const resolutionMs = benchmark.resolutionMs.toFixed(1);
  const runs = benchmark.runs ?? 3;

  return (
    <div className="flex-1 max-w-4xl mx-auto px-8 w-full py-16">
      <h1 className="text-4xl md:text-5xl font-black tracking-tight text-[var(--text-main)]">
        Benchmarks
      </h1>
      <p className="text-lg text-[var(--text-muted)] mt-4 max-w-3xl leading-relaxed">
        Two independent measurements. Neither says anything about the other, and each
        compares a different category — read the framing before the figures.
      </p>

      {/* ── Runtime ─────────────────────────────────────────────────────────── */}
      <h2 className={H2}>Runtime — a rendering-layer comparison</h2>
      <p className={P}>
        This measures OTF Web&rsquo;s <strong>runtime</strong> against the React, Solid and
        Svelte&nbsp;5 <strong>libraries</strong> — <code>react</code>+<code>react-dom</code>,{" "}
        <code>solid-js</code>, <code>svelte</code>. It is <em>not</em> a comparison against
        Next.js, SolidStart or SvelteKit. The case is a single page of reactive list
        updates, so no router, build step or SSG code runs on any side.
      </p>

      <div className={CARD}>
        <BenchmarkTable report={benchmark} />
      </div>

      <p className={P}>
        OTF Web leads no operation here. Solid takes <em>create 1,000 rows</em>; the other
        seven rows are ties. It is well clear of React on <em>swap 2 rows</em> (33 vs 246)
        and <em>clear 10,000</em> (179 vs 261).
      </p>

      <h3 className={H3}>Method</h3>
      <p className={P}>
        The standard{" "}
        <a href="https://github.com/krausest/js-framework-benchmark" className={A}>
          js-framework-benchmark
        </a>{" "}
        operation set, through one shared harness: production builds, 4× CPU throttling
        applied over CDP before the page loads, and each operation timed by a double
        <code>requestAnimationFrame</code> around one synchronous state write. Every case
        uses keyed rows and the identical <code>measure</code>/<code>nextFrame</code>{" "}
        helpers and DOM shape.
      </p>

      <h3 className={H3}>Why the figures pool several runs</h3>
      <p className={P}>
        Double-rAF timing quantizes to frame boundaries, giving a resolution of about{" "}
        {resolutionMs}&nbsp;ms — and on the create rows OTF Web, Solid and Svelte sit
        within roughly 20&nbsp;ms of one another. A single run&rsquo;s margins there are
        smaller than its own run-to-run drift: three consecutive runs on an idle machine
        named three different winners for <em>create 1,000 rows</em>, and Solid&rsquo;s own
        median swung 13% (231–262&nbsp;ms) across them. Bolding any one run would report a
        coin flip, so the published table pools the raw samples of {runs} full runs and
        takes the median of the pool — the same statistic, at N≈30 rather than N≈10. A cell
        is bolded only where the margin exceeds the timing resolution; most do not.
      </p>

      <h3 className={H3}>What is and is not fair here</h3>
      <p className={P}>
        The asymmetry between a framework and a view library is real, but it lands{" "}
        <em>outside</em> the measured window. The OTF Web case is built with the full{" "}
        <code>otfw build</code> toolchain and boots the router and mount layer; the other
        three are minimal hand-rolled bundles with no router. That cost is paid once at
        startup and never enters a timed sample, so it neither inflates nor deflates the
        per-operation medians — but it does mean OTF Web carries weight the others do not.
        For the same reason, a bundle-size column would <em>not</em> belong in this table.
      </p>
      <p className={P}>
        React&rsquo;s <em>swap 2 rows</em> result is a genuine characteristic rather than a
        handicapped implementation: plain keyed React re-renders and reconciles the whole
        list, and the reference benchmark&rsquo;s baseline React entry is likewise
        unmemoized. Memoizing rows would close much of that gap.
      </p>

      <div className={NOTE}>
        These operations are precisely where fine-grained libraries are already at parity
        with OTF Web, which is why seven of eight rows tie. The properties that distinguish
        it as a framework — native custom elements, hydration by adoption, per-route chunks
        — show up in JavaScript shipped per route, cold start, hydration cost and SPA
        navigation, none of which this benchmark measures. Treat it as evidence about the
        rendering layer and nothing more.
      </div>

      {/* ── Build ───────────────────────────────────────────────────────────── */}
      <h2 className={H2}>Build cost — a framework-level comparison</h2>
      <p className={P}>
        This one compares frameworks: Astro, Next.js and TanStack Start are full
        frameworks, and Vite is the underlying build tool included as a floor. It measures
        the cost of <em>building</em> a static site, not of serving one — five toolchains
        pre-rendering the same 72&nbsp;KB MDX documentation page.
      </p>

      <div className={CARD}>
        <BenchmarkTable report={ssgBenchmark} rowHeader="Metric" />
      </div>

      <h3 className={H3}>Read the asymmetries first</h3>
      <p className={P}>
        The columns do not represent equal work. <code>astro</code> and <code>vite</code>{" "}
        ship no client JavaScript for these pages, whereas OTF Web, Next.js and TanStack
        Start additionally build a hydration bundle. Two smaller asymmetries run the other
        way, against OTF Web: it is the only tool that syntax-highlights the code blocks at
        build time, and Next.js inlines an RSC payload the others have no equivalent of.
      </p>
      <p className={P}>
        The figures also come from two separate runs. The OTF Web column was re-measured
        after the build fixes in <code>@opentf/web-compiler</code> and re-verified across
        the whole 72&nbsp;KB–2.3&nbsp;MB ladder; the other four are from the original sweep
        and were not re-run, so small gaps should be treated as noise. The 72&nbsp;KB
        memory cell read 122–140&nbsp;MB between two consecutive runs, which is this
        benchmark&rsquo;s noise floor for that cell.
      </p>
      <p className={P}>
        The advantage holds across the size ladder — a 2.3&nbsp;MB page builds in
        2.9&nbsp;s against Astro&rsquo;s 3.7&nbsp;s — where it previously reversed beyond
        roughly a megabyte.
      </p>

      {/* ── Reproduce ───────────────────────────────────────────────────────── */}
      <h2 className={H2}>Reproduce them</h2>
      <pre className="max-w-3xl overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 text-sm leading-relaxed">
        <code>{`# runtime — repeat a few times, then pool
bun run bench all
bun benchmarks/aggregate.mjs --latest 3

# build cost — see benchmarks/ssg-build/README.md`}</code>
      </pre>
      <p className={P}>
        Full method, every caveat, and the complete size ladder live in the repository:{" "}
        <a
          href="https://github.com/Open-Tech-Foundation/Web-App-Framework/blob/main/benchmarks/README.md"
          className={A}
        >
          benchmarks/README.md
        </a>{" "}
        and{" "}
        <a
          href="https://github.com/Open-Tech-Foundation/Web-App-Framework/blob/main/benchmarks/ssg-build/README.md"
          className={A}
        >
          benchmarks/ssg-build
        </a>
        .
      </p>
    </div>
  );
}
