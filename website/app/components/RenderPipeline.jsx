// Rendering pipelines — one update's path through each framework, next to ours.
//
// Five framework tabs on the left (React, Vue, Angular, Svelte, Solid), OTF
// pinned on the right. Each stack names that framework's real layers — VDOM
// appears only where one exists (React, Vue); the compiled frameworks get an
// explicit "No VDOM" marker instead of a gap. No timings, no scores: layer
// names, one honest note each. Brand marks are official SVGs in public/img.
//
// "Play update" flashes both stacks top to bottom — the path one state change
// travels. Flashes are WAAPI fired imperatively; SSG renders the static stacks.

import { onMount } from "@opentf/web";

const OTF = {
  id: "otf",
  name: "OTF Web",
  logo: "/img/otf-logo.svg",
  layers: [
    { label: "JSX components" },
    { label: "otfwc compiler" },
    { label: "Web components" },
    { label: "otfw runtime" },
    { label: "DOM updates" },
  ],
  note: "Standard custom elements + signals; the compiler emits native DOM bindings.",
};

const FRAMEWORKS = [
  {
    id: "react",
    name: "React",
    logo: "/img/react.svg",
    layers: [
      { label: "JSX components" },
      { label: "React Compiler" },
      { label: "React components" },
      { label: "VDOM", kind: "vdom" },
      { label: "DOM updates" },
    ],
    note: "Components re-render on state change; the VDOM diff computes the DOM patch.",
  },
  {
    id: "vue",
    name: "Vue",
    logo: "/img/vuedotjs.svg",
    layers: [
      { label: "SFC components" },
      { label: "Vue compiler" },
      { label: "Vue components" },
      { label: "VDOM", kind: "vdom" },
      { label: "DOM updates" },
    ],
    note: "Single-file components compile to render functions; an optimized VDOM patches the DOM.",
  },
  {
    id: "angular",
    name: "Angular",
    logo: "/img/angular.svg",
    layers: [
      { label: "Templates" },
      { label: "AOT compiler (Ivy)" },
      { label: "Components" },
      { label: "Change detection" },
      { label: "DOM updates" },
    ],
    note: "No VDOM — change detection checks component bindings and writes the DOM.",
  },
  {
    id: "svelte",
    name: "Svelte",
    logo: "/img/svelte.svg",
    layers: [
      { label: "Svelte components" },
      { label: "Svelte compiler" },
      { label: "Runes / signals" },
      { label: "No VDOM", kind: "novdom" },
      { label: "DOM updates" },
    ],
    note: "Reactivity compiles to targeted DOM writes; there is no virtual tree.",
  },
  {
    id: "solid",
    name: "Solid",
    logo: "/img/solid.svg",
    layers: [
      { label: "JSX components" },
      { label: "Babel transform" },
      { label: "Components (run once)" },
      { label: "Signals runtime" },
      { label: "No VDOM", kind: "novdom" },
      { label: "DOM updates" },
    ],
    note: "Components execute once; fine-grained signals update bindings directly.",
  },
];

export default function RenderPipeline() {
  let selected = $state("react");
  const rootRef = $ref();

  // Auto-tour: advance through every framework, playing each update flow.
  // Any manual interaction (tab or Play) stops the tour — the user owns it after.
  let tour = null;
  const stopTour = () => {
    if (tour) {
      clearInterval(tour);
      tour = null;
    }
  };

  const current = () => FRAMEWORKS.find((f) => f.id === selected) ?? FRAMEWORKS[0];

  const animate = (el, frames, opts) => {
    if (el && typeof el.animate === "function") el.animate(frames, opts);
  };

  // Flash one stack's chips top to bottom — the path a state change travels.
  const playStack = (panel) => {
    const root = rootRef;
    if (!root) return;
    root.querySelectorAll(`[data-pl="${panel}"] .pipe-chip`).forEach((el, i) => {
      animate(
        el,
        [
          { background: "var(--accent-soft)", offset: 0 },
          { background: "var(--accent-soft)", offset: 0.5 },
          { background: "rgba(0,0,0,0)" },
        ],
        { duration: 560, delay: i * 150, easing: "ease-out" },
      );
    });
  };

  const play = () => {
    playStack("left");
    playStack("right");
  };

  const tourStep = () => {
    const i = FRAMEWORKS.findIndex((f) => f.id === selected);
    selected = FRAMEWORKS[(i + 1) % FRAMEWORKS.length].id;
    play();
  };

  onMount(() => {
    stopTour();
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    // Opening pass on React, then tour every framework in turn.
    setTimeout(play, 800);
    tour = setInterval(tourStep, 3400);
  });

  return (
    <div ref={rootRef}>
      <div className="pipe-body">
        {/* Stacks are written out (not a shared helper returning JSX): the
            compiler binds a helper's returned element as text. */}
        <div className="pipe-duel">
          <div className="pipe-stack" data-pl="left">
            <div className="pipe-stack-head">
              <img className={current().id === "angular" ? "pipe-logo is-angular" : "pipe-logo"} src={current().logo} alt="" width="18" height="18" loading="lazy" />
              {current().name}
            </div>
            {/* Uniform item shape (never a conditional branch): keyed lists with
                mixed item shapes crash the list reconciler, and ternaries lower
                to unsupported multi-node roots. Variance lives in attributes. */}
            {current().layers.map((l) => (
              <div
                key={l.label}
                className={l.kind === "novdom" ? "pipe-chip is-ghost" : "pipe-chip"}
              >
                {l.label}
              </div>
            ))}
            <p className="pipe-note">{current().note}</p>
          </div>
          <div className="pipe-vs" aria-hidden="true">
            vs
          </div>
          <div className="pipe-stack is-ours" data-pl="right">
            <div className="pipe-stack-head">
              <img className="pipe-logo" src={OTF.logo} alt="" width="18" height="18" loading="lazy" />
              {OTF.name}
            </div>
            {OTF.layers.map((l) => (
              <div key={l.label} className="pipe-chip">
                {l.label}
              </div>
            ))}
            <p className="pipe-note">{OTF.note}</p>
          </div>
        </div>
        <p className="pipe-caption">Layer names, not timings — what runs, in order, when state changes.</p>
      </div>
    </div>
  );
}
