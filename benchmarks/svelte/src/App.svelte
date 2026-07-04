<!--
  Svelte 5 implementation of the js-framework-benchmark (krausest) operation set.
  Mirrors benchmarks/otfw exactly. `$state.raw` is the fair choice for `rows`:
  every operation replaces the whole array (never mutates in place), so deep
  proxying each of 10,000 rows would add overhead the pattern never uses — raw
  state tracks the reassignment, matching how React/Solid/OTF Web update here.
-->
<script>
  import { onMount } from "svelte";
  import { buildRows, measure, nextFrame } from "./_bench.js";

  let rows = $state.raw([]);
  let selected = $state(-1);
  let status = $state("idle");
  let results = $state(null);

  // --- Operations ------------------------------------------------------------
  const run = () => (rows = buildRows(1000));
  const runLots = () => (rows = buildRows(10000));
  const add = () => (rows = [...rows, ...buildRows(1000)]);
  const clear = () => (rows = []);

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

  const select = (id) => (selected = id);
  const remove = (id) => (rows = rows.filter((r) => r.id !== id));

  // --- Measurement (shared `measure` from _bench.js, identical across cases) --
  async function runAll() {
    status = "running";
    results = null;
    const empty = () => (rows = []);

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
        () => { run(); selected = -1; },
        () => select(rows[500].id),
        12,
      ),
    );
    cases.push(
      await measure("remove row (1k)", run, () => remove(rows[500].id), 12),
    );
    cases.push(await measure("clear 10,000 rows", runLots, clear, 5, 1));

    clear();
    results = cases;
    status = "done";
    window.__BENCH_RESULTS__ = { engine: "svelte", ua: navigator.userAgent, cases };
    window.__BENCH_DONE__ = true;
  }

  onMount(() => {
    if (new URLSearchParams(location.search).has("autorun")) runAll();
  });
</script>

<div>
  <h1>Svelte — Benchmark</h1>

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

  {#if results}
    <pre id="results">{JSON.stringify(results, null, 2)}</pre>
  {/if}

  <table>
    <tbody>
      {#each rows as row (row.id)}
        <tr class:danger={selected === row.id}>
          <td class="col-id">{row.id}</td>
          <td><a onclick={() => select(row.id)}>{row.label}</a></td>
          <td><button onclick={() => remove(row.id)}>✕</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
