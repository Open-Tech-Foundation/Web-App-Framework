// Render duel — the homepage hero's "native vs VDOM" sketch.
//
// One shared update (row N of 6 changes) plays out on two panels. The VDOM side
// cascades a "diff" flash across every row before patching the one; the native
// side writes the one bound row. The tallies count what each side *visited* per
// update (VDOM: all rows, native: the binding) and what it wrote — honest
// bookkeeping, not timings. For measured numbers, /docs/benchmarks.
//
// State idioms follow the docs: rows are a `$state` array replaced whole on
// update (never mutated in place), tallies are scalars, flashes are WAAPI fired
// imperatively from the bump handler. SSG renders the initial board; motion
// starts client-side in `onMount` (paused up front for reduced-motion users).

import { onMount } from "@opentf/web";

const ROWS = 6;
const BASE = [12, 7, 31, 4, 19, 26];

export default function RenderDuel() {
  let vals = $state([...BASE]);
  let target = $state(2);
  let playing = $state(true);
  let vVisited = $state(0);
  let vWrites = $state(0);
  let nVisited = $state(0);
  let nWrites = $state(0);

  const rootRef = $ref();
  let timer = null;

  const animate = (el, frames, opts) => {
    if (el && typeof el.animate === "function") el.animate(frames, opts);
  };

  const flash = (el, color, delay = 0) =>
    animate(
      el,
      [
        { background: color, offset: 0 },
        { background: color, offset: 0.45 },
        { background: "rgba(0,0,0,0)" },
      ],
      { duration: 620, delay, easing: "ease-out" },
    );

  // One shared update: row `target` advances, both tallies book it, both panels
  // flash their own story — the VDOM cascade visits every row, native writes one.
  function bump() {
    target = (target + 1) % ROWS;
    vals = vals.map((v, i) => (i === target ? v + 1 : v));
    vVisited = vVisited + ROWS;
    vWrites = vWrites + 1;
    nVisited = nVisited + 1;
    nWrites = nWrites + 1;
    const root = rootRef;
    if (!root) return;
    root.querySelectorAll("[data-vrow]").forEach((el, i) => {
      flash(el, "rgba(239,68,68,0.14)", i * 55);
    });
    flash(root.querySelector(`[data-nrow="${target}"]`), "var(--accent-soft)");
  }

  function setPlaying(next) {
    playing = next;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (next) timer = setInterval(bump, 2100);
  }

  onMount(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      playing = false;
      return;
    }
    // One opening update so the board reads as live, then the loop.
    const intro = setTimeout(() => {
      bump();
      timer = setInterval(bump, 2100);
    }, 900);
    void intro;
  });

  const rows = (side) =>
    vals.map((v, i) => (
      <div
        key={i}
        className={i === target ? `duel-row is-hot` : `duel-row`}
        data-vrow={side === "vdom" ? i : undefined}
        data-nrow={side === "native" ? i : undefined}
      >
        <span className="duel-cell">{`r${i + 1}`}</span>
        <span className="duel-val">{v}</span>
      </div>
    ));

  return (
    <div className="duel" ref={rootRef}>
      <div className="win-titlebar">
        <span className="win-light is-red"></span>
        <span className="win-light is-amber"></span>
        <span className="win-light is-green"></span>
        <span className="win-titlebar-label">update.jsx — one update, two renderers</span>
      </div>
      <div className="duel-body">
        <div className="duel-panels">
          <div className="duel-panel is-vdom">
            <div className="duel-panel-head">
              <span className="duel-dot is-vdom"></span>VDOM
            </div>
            {rows("vdom")}
            <div className="duel-tally">
              visited {vVisited} · wrote {vWrites}
            </div>
          </div>
          <div className="duel-panel is-native">
            <div className="duel-panel-head">
              <span className="duel-dot is-native"></span>Native · OTF
            </div>
            {rows("native")}
            <div className="duel-tally">
              visited {nVisited} · wrote {nWrites}
            </div>
          </div>
        </div>
        <div className="duel-controls">
          <button className="duel-btn" onclick={() => bump()}>
            Update a row
          </button>
          <button
            className={playing ? "duel-btn is-on" : "duel-btn"}
            onclick={() => setPlaying(!playing)}
            aria-pressed={playing ? "true" : "false"}
          >
            {playing ? "Pause" : "Auto-play"}
          </button>
        </div>
        <p className="duel-caption">
          A stylized sketch of a single update — not a measurement. The VDOM panel
          re-evaluates every row to find the change; OTF writes the one binding.
        </p>
      </div>
    </div>
  );
}
