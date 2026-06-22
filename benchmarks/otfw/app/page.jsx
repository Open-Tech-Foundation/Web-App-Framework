// OTF Web implementation of the js-framework-benchmark (krausest) operation set.
// The same component serves two modes:
//   • manual — click the control buttons; the table updates reactively.
//   • measured — "Run all", or load with ?autorun, runs every operation N times
//     and reports the median time-to-next-frame for each (see app/_bench.js).
//
// The measured contract (read by benchmarks/run.mjs and shared by every engine):
//   window.__BENCH_RESULTS__ = { engine, ua, cases: [{ label, median, runs }] }
//   window.__BENCH_DONE__    = true   // set once, after all cases complete

import { buildRows, median, nextFrame } from "./_bench.js";

export default function Bench() {
  let rows = $state([]);
  let selected = $state(-1);
  let status = $state("idle");
  let results = $state(null);

  // --- Operations (each a single synchronous reactive write) ------------------
  const run = () => { rows = buildRows(1000); };
  const runLots = () => { rows = buildRows(10000); };
  const add = () => { rows = [...rows, ...buildRows(1000)]; };
  const clear = () => { rows = []; };

  const update = () => {
    const next = rows.slice();
    for (let i = 0; i < next.length; i += 10) {
      next[i] = { ...next[i], label: next[i].label + " !!!" };
    }
    rows = next;
  };

  const swapRows = () => {
    if (rows.length <= 998) return;
    const next = rows.slice();
    const tmp = next[1];
    next[1] = next[998];
    next[998] = tmp;
    rows = next;
  };

  const select = (id) => { selected = id; };
  const remove = (id) => { rows = rows.filter((r) => r.id !== id); };

  // --- Measurement ------------------------------------------------------------
  // One case: re-establish the precondition, settle a frame, time the op up to
  // the next painted frame, repeat. Returns the median over `runs` samples.
  async function measure(label, setup, op, runs) {
    const times = [];
    for (let i = 0; i < runs; i++) {
      setup();
      await nextFrame();
      const t0 = performance.now();
      op();
      await nextFrame();
      times.push(performance.now() - t0);
    }
    return { label, median: +median(times).toFixed(2), runs };
  }

  async function runAll() {
    if (status === "running") return;
    status = "running";
    results = null;
    const empty = () => { rows = []; };

    // Warm up the JIT and the keyed-list path before the first timed sample.
    run(); await nextFrame(); clear(); await nextFrame();

    const cases = [];
    cases.push(await measure("create 1,000 rows", empty, run, 5));
    cases.push(await measure("create 10,000 rows", empty, runLots, 3));
    cases.push(await measure("append 1,000 to 1,000", run, add, 5));
    cases.push(await measure("update every 10th (1k)", run, update, 5));
    cases.push(await measure("swap 2 rows (1k)", run, swapRows, 5));
    cases.push(
      await measure(
        "select row (1k)",
        () => { run(); selected = -1; },
        () => select(rows[500].id),
        5,
      ),
    );
    cases.push(
      await measure("remove row (1k)", run, () => remove(rows[500].id), 5),
    );
    cases.push(await measure("clear 10,000 rows", runLots, clear, 5));

    clear();
    results = cases;
    status = "done";
    window.__BENCH_RESULTS__ = {
      engine: "otfw",
      ua: navigator.userAgent,
      cases,
    };
    window.__BENCH_DONE__ = true;
  }

  onMount(() => {
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  });

  return (
    <div>
      <h1>OTF Web — Benchmark</h1>

      <div class="controls">
        <button onclick={run}>Create 1,000</button>
        <button onclick={runLots}>Create 10,000</button>
        <button onclick={add}>Append 1,000</button>
        <button onclick={update}>Update every 10th</button>
        <button onclick={swapRows}>Swap rows</button>
        <button onclick={clear}>Clear</button>
        <button class="primary" onclick={runAll}>▶ Run all (measured)</button>
      </div>

      <p class="status">Status: {status}</p>

      {results ? (
        <pre id="results">{JSON.stringify(results, null, 2)}</pre>
      ) : (
        <span></span>
      )}

      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selected === row.id ? "danger" : ""}>
              <td class="col-id">{row.id}</td>
              <td>
                <a onclick={() => select(row.id)}>{row.label}</a>
              </td>
              <td>
                <button onclick={() => remove(row.id)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
