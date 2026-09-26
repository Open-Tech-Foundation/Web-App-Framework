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
    { label: "JSX components", icon: "code" },
    { label: "otfwc compiler", icon: "gear" },
    { label: "Web components", icon: "corners" },
    { label: "Signals", icon: "bolt" },
    { label: "Framework runtime", icon: "layers" },
    { label: "DOM updates", icon: "monitor" },
  ],
  note: "Standard custom elements + signals; the compiler emits native DOM bindings.",
};

const FRAMEWORKS = [
  {
    id: "react",
    name: "React",
    logo: "/img/react.svg",
    layers: [
      { label: "JSX components", icon: "code" },
      { label: "React Compiler", icon: "sparkles" },
      { label: "React components", icon: "puzzle" },
      { label: "VDOM", icon: "tree" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Auto-memoized by the React Compiler (opt-in); re-rendered components diff through the VDOM to the DOM patch.",
  },
  {
    id: "vue",
    name: "Vue",
    logo: "/img/vuedotjs.svg",
    layers: [
      { label: "SFC components", icon: "file" },
      { label: "Vue compiler", icon: "gear" },
      { label: "Vue components", icon: "puzzle" },
      { label: "VDOM", icon: "tree" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Default path: templates compile to render functions; the VDOM patches the DOM. Vapor Mode (3.6, opt-in) and alien-signals reactivity skip it.",
  },
  {
    id: "angular",
    name: "Angular",
    logo: "/img/angular.svg",
    layers: [
      { label: "Templates", icon: "layout" },
      { label: "AOT compiler (Ivy)", icon: "gear" },
      { label: "Components", icon: "puzzle" },
      { label: "Signals (zoneless CD)", icon: "bolt" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Signals are the reactive primitive; zoneless change detection (default since v21) refreshes dirty views — no Zone.js, no VDOM.",
  },
  {
    id: "svelte",
    name: "Svelte",
    logo: "/img/svelte.svg",
    layers: [
      { label: "Svelte components", icon: "file" },
      { label: "Svelte compiler", icon: "gear" },
      { label: "Runes / signals", icon: "bolt" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Reactivity compiles to targeted DOM writes; there is no virtual tree.",
  },
  {
    id: "solid",
    name: "Solid",
    logo: "/img/solid.svg",
    layers: [
      { label: "JSX components", icon: "code" },
      { label: "Oxc compiler (native)", icon: "gear" },
      { label: "Components (run once)", icon: "play" },
      { label: "Signals runtime", icon: "bolt" },
      { label: "DOM updates", icon: "monitor" },
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
      {/* Icon sprite: one static <defs> block, chips reference symbols by href.
          Everything here is literal markup — no helpers returning elements (the
          compiler binds those as text) and no fragments (unsupported). */}
      <svg width="0" height="0" style="position:absolute" aria-hidden="true">
        <defs>
          <symbol id="pi-code" viewBox="0 0 24 24"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></symbol>
          <symbol id="pi-sparkles" viewBox="0 0 24 24"><path d="M12 3l1.9 5.7 5.7 1.9-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9z" /></symbol>
          <symbol id="pi-puzzle" viewBox="0 0 24 24"><g><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></g></symbol>
          <symbol id="pi-tree" viewBox="0 0 24 24"><g><circle cx="12" cy="5" r="2.2" /><circle cx="5.5" cy="19" r="2.2" /><circle cx="18.5" cy="19" r="2.2" /><path d="M12 7.5v4m0 0l-5 5.5m5-5.5l5 5.5" /></g></symbol>
          <symbol id="pi-monitor" viewBox="0 0 24 24"><g><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></g></symbol>
          <symbol id="pi-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" /></symbol>
          <symbol id="pi-gear" viewBox="0 0 24 24"><g><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1m0-14.2l-2.1 2.1m-10 10l-2.1 2.1" /></g></symbol>
          <symbol id="pi-layout" viewBox="0 0 24 24"><g><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></g></symbol>
          <symbol id="pi-bolt" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></symbol>
          <symbol id="pi-play" viewBox="0 0 24 24"><g><circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" /></g></symbol>
          <symbol id="pi-corners" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" /></symbol>
          <symbol id="pi-layers" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></symbol>
        </defs>
      </svg>
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
              <div key={l.label} className="pipe-chip">
                <svg className="pipe-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <use href={"#pi-" + l.icon} />
                </svg>
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
                <svg className="pipe-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <use href={"#pi-" + l.icon} />
                </svg>
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
