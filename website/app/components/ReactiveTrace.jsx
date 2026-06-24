// "Watch a change flow" — the homepage's headline demo.
//
// It runs on real OTF Web reactivity: `qty`/`price`/`coupon` are `$state`, and
// `subtotal`/`tax`/`total` are `$derived`. The visualization is driven by the
// framework itself — each graph node has an `$effect` that reads its value, so a
// node only pulses when the runtime *actually* recomputed it. Change `qty` and the
// pulse propagates qty → subtotal → tax → total and flashes exactly those DOM
// numbers; the coupon field (an unrelated signal) stays dark. That untouched node is
// the point: it's what "fine-grained, zero-VDOM" looks like.
//
// A "compare to a VDOM" toggle flips the right panel to outline the *whole* subtree
// on any change — what a diff-based renderer re-evaluates — for contrast.
//
// Note: the cascade is staggered (by graph depth) purely so the dependency order is
// legible. OTF's real flush is synchronous and instant.

import { onMount } from "@opentf/web";

// Node centers in the 340×300 graph box (matches the SVG viewBox and the CSS
// left/top of each node), plus each node's depth for the stagger.
const DEPTH = { qty: 0, price: 0, coupon: 0, subtotal: 1, tax: 2, total: 3 };
// Edges feeding each node, animated when that node pulses.
const INTO = {
  subtotal: ["qty-subtotal", "price-subtotal"],
  tax: ["subtotal-tax"],
  total: ["subtotal-total", "tax-total"],
};
const STEP = 120; // ms per dependency level

const money = (n) => "$" + n.toFixed(2);

export default function ReactiveTrace() {
  let qty = $state(2);
  let price = $state(9);
  let coupon = $state("");
  let showVdom = $state(false);

  const subtotal = $derived(qty * price);
  const tax = $derived(subtotal * 0.1);
  const total = $derived(subtotal + tax);

  const rootRef = $ref();

  // Plain (untracked) mirrors so the per-node effects don't depend on `showVdom`
  // or a readiness flag — toggling the mode must not itself trigger a flash, and
  // the effects' first (mount-time) run must stay silent.
  let ready = false;
  let vdomMode = false;
  $effect(() => {
    vdomMode = showVdom;
  });

  const animate = (el, frames, opts) => el && el.animate(frames, opts);

  // Pulse a graph node and the edges feeding it, staggered by dependency depth.
  // `value` is the node's freshly-read signal value — surfaced as a tooltip (a real
  // use, so the tracking read in each effect is never optimized away).
  const pulseNode = (id, value) => {
    const root = rootRef;
    if (!root) return;
    const delay = (DEPTH[id] || 0) * STEP;
    const inner = root.querySelector(`[data-node="${id}"] .trace-node-chip`);
    if (inner && value !== undefined) inner.setAttribute("title", String(value));
    animate(
      inner,
      [
        { transform: "scale(1)", boxShadow: "0 0 0 0 var(--accent-soft)" },
        { transform: "scale(1.14)", boxShadow: "0 0 0 7px var(--accent-soft)", offset: 0.35 },
        { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(0,0,0,0)" },
      ],
      { duration: 640, delay, easing: "ease-out" },
    );
    for (const e of INTO[id] || []) {
      const path = root.querySelector(`[data-edge="${e}"]`);
      if (!path) continue;
      const len = path.getTotalLength ? path.getTotalLength() : 120;
      path.style.strokeDasharray = String(len);
      animate(
        path,
        [
          { strokeDashoffset: len, stroke: "var(--accent)", strokeWidth: 3 },
          { strokeDashoffset: 0, stroke: "var(--accent)", strokeWidth: 3 },
        ],
        { duration: 460, delay: Math.max(0, delay - STEP), easing: "ease-in-out" },
      );
    }
  };

  // Flash the exact DOM node a binding updated (granular / OTF mode).
  const flashDom = (id) => {
    const root = rootRef;
    if (!root) return;
    const el = root.querySelector(`[data-dom="${id}"]`);
    animate(
      el,
      [
        { background: "var(--accent-soft)", color: "var(--accent)", offset: 0 },
        { background: "var(--accent-soft)", color: "var(--accent)", offset: 0.4 },
        { background: "rgba(0,0,0,0)", color: "var(--text-main)" },
      ],
      { duration: 700, delay: (DEPTH[id] || 0) * STEP, easing: "ease-out" },
    );
  };

  // Outline the whole cart subtree (what a VDOM diff re-evaluates).
  const flashSubtree = () => {
    const root = rootRef;
    if (!root) return;
    const card = root.querySelector("[data-dom-card]");
    animate(
      card,
      [
        { boxShadow: "0 0 0 0 rgba(239,68,68,0)", borderColor: "var(--border)" },
        { boxShadow: "0 0 0 3px rgba(239,68,68,0.35)", borderColor: "#ef4444", offset: 0.4 },
        { boxShadow: "0 0 0 0 rgba(239,68,68,0)", borderColor: "var(--border)" },
      ],
      { duration: 700, easing: "ease-out" },
    );
  };

  // One effect per node. `const v = …` reads (and tracks) the value on every run —
  // including the silent mount run — then animates only once `ready`. The runtime
  // re-runs an effect *only* when its own dependency changed, so the set of effects
  // that fire on a given edit is exactly the propagation set. (Each must be a direct
  // top-level `$effect` — the macro is only lowered in the component body, not inside
  // a nested helper.)
  $effect(() => {
    const v = qty;
    if (ready) {
      pulseNode("qty", v);
      if (!vdomMode) flashDom("qty");
    }
  });
  $effect(() => {
    const v = price;
    if (ready) {
      pulseNode("price", v);
      if (!vdomMode) flashDom("price");
    }
  });
  $effect(() => {
    const v = coupon;
    if (ready) {
      pulseNode("coupon", v);
      if (!vdomMode) flashDom("coupon");
    }
  });
  $effect(() => {
    const v = subtotal;
    if (ready) {
      pulseNode("subtotal", v);
      if (!vdomMode) flashDom("subtotal");
    }
  });
  $effect(() => {
    const v = tax;
    if (ready) {
      pulseNode("tax", v);
      if (!vdomMode) flashDom("tax");
    }
  });
  $effect(() => {
    const v = total;
    if (ready) {
      pulseNode("total", v);
      if (!vdomMode) flashDom("total");
    }
  });

  // Whole-subtree flash for VDOM-compare mode: tracks every input, fires on any edit.
  $effect(() => {
    const sum = qty + price + coupon.length;
    if (ready && vdomMode && sum >= 0) flashSubtree();
  });

  onMount(() => {
    ready = true;
    // A one-time intro cascade so the demo reads as live before any interaction.
    setTimeout(() => {
      for (const id of ["qty", "subtotal", "tax", "total"]) {
        pulseNode(id);
        if (!vdomMode) flashDom(id);
      }
    }, 650);
  });

  return (
    <div className="trace" ref={rootRef}>
      <div className="trace-toolbar">
        <div className="trace-legend">
          <span className="trace-legend-item">
            <span className="trace-dot is-state"></span>$state
          </span>
          <span className="trace-legend-item">
            <span className="trace-dot is-derived"></span>$derived
          </span>
        </div>
        <button
          className={showVdom ? "trace-toggle is-on" : "trace-toggle"}
          onclick={() => (showVdom = !showVdom)}
          aria-pressed={showVdom ? "true" : "false"}
        >
          <span className="trace-toggle-knob"></span>
          Compare to a VDOM
        </button>
      </div>

      <div className="trace-panels">
        {/* Reactive graph */}
        <div className="trace-graph-wrap">
          <div className="trace-graph">
            <svg className="trace-edges" width="340" height="300" viewBox="0 0 340 300" aria-hidden="true">
              <path className="trace-edge" data-edge="qty-subtotal" d="M60 45 L130 140" />
              <path className="trace-edge" data-edge="price-subtotal" d="M200 45 L130 140" />
              <path className="trace-edge" data-edge="subtotal-tax" d="M130 140 L70 235" />
              <path className="trace-edge" data-edge="subtotal-total" d="M130 140 L200 235" />
              <path className="trace-edge" data-edge="tax-total" d="M70 235 L200 235" />
            </svg>
            <div className="trace-node is-state" style="left:60px;top:45px" data-node="qty">
              <span className="trace-node-chip">qty</span>
            </div>
            <div className="trace-node is-state" style="left:200px;top:45px" data-node="price">
              <span className="trace-node-chip">price</span>
            </div>
            <div className="trace-node is-derived" style="left:130px;top:140px" data-node="subtotal">
              <span className="trace-node-chip">subtotal</span>
            </div>
            <div className="trace-node is-derived" style="left:70px;top:235px" data-node="tax">
              <span className="trace-node-chip">tax</span>
            </div>
            <div className="trace-node is-derived" style="left:200px;top:235px" data-node="total">
              <span className="trace-node-chip">total</span>
            </div>
            <div className="trace-node is-state trace-node-aside" style="left:290px;top:120px" data-node="coupon">
              <span className="trace-node-chip">coupon</span>
            </div>
          </div>
        </div>

        {/* Live DOM */}
        <div className="trace-dom" data-dom-card>
          <div className="trace-dom-head">Live DOM</div>
          <div className="trace-row">
            <span className="trace-label">Qty</span>
            <span className="trace-stepper">
              <button onclick={() => qty > 1 && (qty = qty - 1)} aria-label="Decrease quantity">
                –
              </button>
              <span className="trace-value" data-dom="qty">
                {qty}
              </span>
              <button onclick={() => (qty = qty + 1)} aria-label="Increase quantity">
                +
              </button>
            </span>
          </div>
          <div className="trace-row">
            <span className="trace-label">Price</span>
            <span className="trace-stepper">
              <button onclick={() => price > 1 && (price = price - 1)} aria-label="Decrease price">
                –
              </button>
              <span className="trace-value" data-dom="price">
                {money(price)}
              </span>
              <button onclick={() => (price = price + 1)} aria-label="Increase price">
                +
              </button>
            </span>
          </div>
          <div className="trace-divider"></div>
          <div className="trace-row">
            <span className="trace-label">Subtotal</span>
            <span className="trace-value is-derived" data-dom="subtotal">
              {money(subtotal)}
            </span>
          </div>
          <div className="trace-row">
            <span className="trace-label">Tax (10%)</span>
            <span className="trace-value is-derived" data-dom="tax">
              {money(tax)}
            </span>
          </div>
          <div className="trace-row trace-row-total">
            <span className="trace-label">Total</span>
            <span className="trace-value is-derived" data-dom="total">
              {money(total)}
            </span>
          </div>
          <div className="trace-divider"></div>
          <div className="trace-row">
            <span className="trace-label">Coupon</span>
            <input
              className="trace-coupon"
              data-dom="coupon"
              type="text"
              placeholder="SAVE10"
              value={coupon}
              oninput={(e) => (coupon = e.target.value)}
            />
          </div>
        </div>
      </div>

      <p className="trace-caption">
        Edit a field. Only the nodes that actually depend on it recompute and flash —
        the rest stay dark. (Staggered to show dependency order; the real flush is
        synchronous.)
      </p>
    </div>
  );
}
