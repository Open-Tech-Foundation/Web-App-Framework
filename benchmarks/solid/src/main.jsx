// Solid implementation of the js-framework-benchmark (krausest) operation set.
// Mirrors benchmarks/otfw exactly. Solid's signals are fine-grained like OTF
// Web's, so the harness reads `rows()` directly — no stale-closure workaround
// is needed (the getter is always current).

import { createSignal, For, onMount } from "solid-js";
import { render } from "solid-js/web";

import { buildRows, measure, nextFrame } from "./_bench.js";

function Bench() {
  const [rows, setRows] = createSignal([]);
  const [selected, setSelected] = createSignal(-1);
  const [status, setStatus] = createSignal("idle");
  const [results, setResults] = createSignal(null);

  // --- Operations -------------------------------------------------------------
  const run = () => setRows(buildRows(1000));
  const runLots = () => setRows(buildRows(10000));
  const add = () => setRows([...rows(), ...buildRows(1000)]);
  const clear = () => setRows([]);

  const update = () => {
    const next = rows().slice();
    for (let i = 0; i < next.length; i += 10) {
      next[i] = { ...next[i], label: next[i].label + " !!!" };
    }
    setRows(next);
  };

  const swapRows = () => {
    const cur = rows();
    if (cur.length <= 998) return;
    const next = cur.slice();
    const tmp = next[1];
    next[1] = next[998];
    next[998] = tmp;
    setRows(next);
  };

  const select = (id) => setSelected(id);
  const remove = (id) => setRows(rows().filter((r) => r.id !== id));

  // --- Measurement (shared `measure` from _bench.js, identical across cases) --
  async function runAll() {
    setStatus("running");
    setResults(null);
    const empty = () => setRows([]);

    run(); await nextFrame(); clear(); await nextFrame(); // warm up

    const cases = [];
    cases.push(await measure("create 1,000 rows", empty, run, 10));
    cases.push(await measure("create 10,000 rows", empty, runLots, 5, 1));
    cases.push(await measure("append 1,000 to 1,000", run, add, 10));
    cases.push(await measure("update every 10th (1k)", run, update, 12));
    cases.push(await measure("swap 2 rows (1k)", run, swapRows, 12));
    cases.push(
      await measure(
        "select row (1k)",
        () => { run(); setSelected(-1); },
        () => select(rows()[500].id),
        12,
      ),
    );
    cases.push(
      await measure("remove row (1k)", run, () => remove(rows()[500].id), 12),
    );
    cases.push(await measure("clear 10,000 rows", runLots, clear, 5, 1));

    clear();
    setResults(cases);
    setStatus("done");
    window.__BENCH_RESULTS__ = { engine: "solid", ua: navigator.userAgent, cases };
    window.__BENCH_DONE__ = true;
  }

  onMount(() => {
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  });

  return (
    <div>
      <h1>Solid — Benchmark</h1>

      <div class="controls">
        <button onClick={run}>Create 1,000</button>
        <button onClick={runLots}>Create 10,000</button>
        <button onClick={add}>Append 1,000</button>
        <button onClick={update}>Update every 10th</button>
        <button onClick={swapRows}>Swap rows</button>
        <button onClick={clear}>Clear</button>
        <button class="primary" onClick={runAll}>▶ Run all (measured)</button>
      </div>

      <p class="status">Status: {status()}</p>

      {results() ? <pre id="results">{JSON.stringify(results(), null, 2)}</pre> : null}

      <table>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr classList={{ danger: selected() === row.id }}>
                <td class="col-id">{row.id}</td>
                <td>
                  <a onClick={() => select(row.id)}>{row.label}</a>
                </td>
                <td>
                  <button onClick={() => remove(row.id)}>✕</button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

render(() => <Bench />, document.getElementById("app"));
