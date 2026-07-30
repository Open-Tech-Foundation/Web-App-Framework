// Static islands interleaved with reactive holes, events and refs — the ordinary
// case. Only the fully-static subtrees may be stamped; the surrounding structure
// still has to be built node by node, and the two must interleave in the right order.
export default function Mixed() {
  let count = $state(2);
  const label = $derived(`count is ${count}`);
  return (
    <section class="panel">
      <header class="head">
        <h2>Panel</h2>
        <p class="sub">A static header above a reactive body.</p>
      </header>
      <p>{label}</p>
      <button type="button" onclick={() => count++}>
        bump
      </button>
      <div class="rows">
        <div class="row static-a">
          <span class="k">alpha</span>
          <span class="v">1</span>
        </div>
        <div class="row live">
          <span class="k">count</span>
          <span class="v">{count}</span>
        </div>
        <div class="row static-b">
          <span class="k">omega</span>
          <span class="v">9</span>
        </div>
      </div>
      <footer class="foot">
        <small>A static footer below it all.</small>
      </footer>
    </section>
  );
}
