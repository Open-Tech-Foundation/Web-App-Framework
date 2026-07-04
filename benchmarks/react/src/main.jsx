// React implementation of the js-framework-benchmark (krausest) operation set.
// Mirrors benchmarks/otfw exactly: same operations, same measurement harness,
// same in-page contract — only the framework differs.
//
//   window.__BENCH_RESULTS__ = { engine, ua, cases: [{ label, median, runs, samples }] }
//   window.__BENCH_DONE__    = true
//
// React detail: the async measurement harness must read the *current* row data
// between awaits, but a value captured from useState is frozen at render time.
// We therefore keep the source of truth in a ref (`rowsRef`) that every mutation
// updates synchronously, and call setState purely to drive React's render/commit
// (with a fresh array identity + keyed children, so reconciliation is real).

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { buildRows, measure, nextFrame } from "./_bench.js";

function Bench() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(-1);
  const [status, setStatus] = useState("idle");
  const [results, setResults] = useState(null);

  const rowsRef = useRef(rows);

  // Commit `next` as the new list: update the ref synchronously (so the harness
  // and subsequent ops read current data) and trigger a React render.
  const commit = (next) => {
    rowsRef.current = next;
    setRows(next);
  };

  // --- Operations (each a single state write) ---------------------------------
  const run = () => commit(buildRows(1000));
  const runLots = () => commit(buildRows(10000));
  const add = () => commit([...rowsRef.current, ...buildRows(1000)]);
  const clear = () => commit([]);

  const update = () => {
    const next = rowsRef.current.slice();
    for (let i = 0; i < next.length; i += 10) {
      next[i] = { ...next[i], label: next[i].label + " !!!" };
    }
    commit(next);
  };

  const swapRows = () => {
    const cur = rowsRef.current;
    if (cur.length <= 998) return;
    const next = cur.slice();
    const tmp = next[1];
    next[1] = next[998];
    next[998] = tmp;
    commit(next);
  };

  const select = (id) => setSelected(id);
  const remove = (id) => commit(rowsRef.current.filter((r) => r.id !== id));

  // --- Measurement (shared `measure` from _bench.js, identical across cases) --
  async function runAll() {
    setStatus("running");
    setResults(null);
    const empty = () => commit([]);

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
        () => select(rowsRef.current[500].id),
        12,
      ),
    );
    cases.push(
      await measure("remove row (1k)", run, () => remove(rowsRef.current[500].id), 12),
    );
    cases.push(await measure("clear 10,000 rows", runLots, clear, 5, 1));

    clear();
    setResults(cases);
    setStatus("done");
    window.__BENCH_RESULTS__ = { engine: "react", ua: navigator.userAgent, cases };
    window.__BENCH_DONE__ = true;
  }

  // Operations are stable closures over refs + stable setState fns, so running
  // once on mount is safe despite the empty dep list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  }, []);

  return (
    <div>
      <h1>React — Benchmark</h1>

      <div className="controls">
        <button onClick={run}>Create 1,000</button>
        <button onClick={runLots}>Create 10,000</button>
        <button onClick={add}>Append 1,000</button>
        <button onClick={update}>Update every 10th</button>
        <button onClick={swapRows}>Swap rows</button>
        <button onClick={clear}>Clear</button>
        <button className="primary" onClick={runAll}>▶ Run all (measured)</button>
      </div>

      <p className="status">Status: {status}</p>

      {results ? <pre id="results">{JSON.stringify(results, null, 2)}</pre> : null}

      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selected === row.id ? "danger" : ""}>
              <td className="col-id">{row.id}</td>
              <td>
                <a onClick={() => select(row.id)}>{row.label}</a>
              </td>
              <td>
                <button onClick={() => remove(row.id)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("app")).render(<Bench />);
