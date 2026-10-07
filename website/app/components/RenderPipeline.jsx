// Build-time preparation and runtime updates, compared with OTF Web.
// Only runtime chips flash: a state change does not rerun the compiler.
// WAAPI illustrates ordering, not elapsed time or comparative performance.
// Hovering the panel pauses the tour so a reader can study the current stacks;
// leaving resumes it. Reduced motion disables the tour entirely.

import { onCleanup, onMediaQuery } from "@opentf/web";

const OTF = {
  name: "OTF Web",
  mode: "Custom elements + signals",
  logo: "/img/otf-logo.svg",
  build: [
    { label: "JSX components", icon: "code" },
    { label: "otfwc compiler", icon: "gear" },
    { label: "Custom elements + bindings", icon: "corners" },
  ],
  updates: [
    { label: "Signal change", icon: "bolt" },
    { label: "Dependent DOM bindings", icon: "layers" },
    { label: "DOM updates", icon: "monitor" },
  ],
  note: "Custom elements manage component lifecycles; signals rerun dependent bindings. No virtual DOM.",
  source: "/docs/core-concepts/reactivity",
};

const FRAMEWORKS = [
  {
    id: "react",
    name: "React",
    mode: "19 · DOM renderer",
    logo: "/img/react.svg",
    build: [
      { label: "JSX components", icon: "code" },
      { label: "React Compiler (optional)", icon: "sparkles" },
      { label: "JSX transform", icon: "gear" },
    ],
    updates: [
      { label: "State update", icon: "bolt" },
      { label: "Component render", icon: "puzzle" },
      { label: "Reconciliation (VDOM)", icon: "tree" },
      { label: "DOM commit", icon: "monitor" },
    ],
    note: "React Compiler adds build-time memoization. React renders affected components and commits necessary DOM changes.",
    source: "https://react.dev/learn/render-and-commit",
  },
  {
    id: "vue",
    name: "Vue",
    mode: "3 · VDOM mode",
    logo: "/img/vuedotjs.svg",
    build: [
      { label: "SFC (.vue)", icon: "file" },
      { label: "Template → render function", icon: "gear" },
    ],
    updates: [
      { label: "Reactive state change", icon: "bolt" },
      { label: "Render effect", icon: "puzzle" },
      { label: "VDOM patch", icon: "tree" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Compiler hints narrow VDOM patching. The 3.6 alien-signals reactivity refactor does not change this rendering mode.",
    source: "https://vuejs.org/guide/extras/rendering-mechanism.html",
  },
  {
    id: "vue-vapor",
    name: "Vue Vapor",
    mode: "3.6 RC · opt-in",
    logo: "/img/vuedotjs.svg",
    build: [
      { label: "SFC with vapor opt-in", icon: "file" },
      { label: "Vapor compiler", icon: "gear" },
    ],
    updates: [
      { label: "Reactive state change", icon: "bolt" },
      { label: "Dependent effects", icon: "layers" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Vapor components update the DOM without VDOM. This opt-in mode supports a subset of Vue APIs; mixed apps can still use VDOM components.",
    source: "https://github.com/vuejs/core/releases/tag/v3.6.0-rc.1",
  },
  {
    id: "angular",
    name: "Angular",
    mode: "21+ · zoneless",
    logo: "/img/angular.svg",
    build: [
      { label: "Components + templates", icon: "layout" },
      { label: "AOT template compiler", icon: "gear" },
    ],
    updates: [
      { label: "Signal / event notification", icon: "bolt" },
      { label: "Scheduled change detection", icon: "layers" },
      { label: "Template bindings", icon: "puzzle" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Zoneless is the default from v21. Template signals, bound events and other Angular notifications schedule view checks. No VDOM.",
    source: "https://angular.dev/guide/zoneless",
  },
  {
    id: "svelte",
    name: "Svelte",
    mode: "5 · runes mode",
    logo: "/img/svelte.svg",
    build: [
      { label: "Components + runes syntax", icon: "file" },
      { label: "Svelte compiler", icon: "gear" },
    ],
    updates: [
      { label: "Reactive state change", icon: "bolt" },
      { label: "Dependent render effects", icon: "layers" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Runes are compiler syntax. Generated code uses runtime signals and effects for targeted DOM updates. No VDOM.",
    source: "https://svelte.dev/docs/svelte/what-are-runes",
  },
  {
    id: "solid",
    name: "Solid",
    mode: "1.x · fine-grained reactivity",
    logo: "/img/solid.svg",
    build: [
      { label: "JSX components", icon: "code" },
      { label: "JSX compiler", icon: "gear" },
    ],
    updates: [
      { label: "Signal change", icon: "bolt" },
      { label: "Dependent DOM bindings", icon: "layers" },
      { label: "DOM updates", icon: "monitor" },
    ],
    note: "Component setup runs once per mount; dependent computations update the DOM. No VDOM. Solid 2.0 (release candidate) adds a native Oxc JSX compiler.",
    source: "https://docs.solidjs.com/concepts/components/basics",
  },
];

export default function RenderPipeline() {
  let selected = $state("react");
  const rootRef = $ref();

  // Auto-tour: advance through every framework, playing each update flow.
  let tour = null;
  let tourStart = null;
  let touring = false; // the tour runs (motion allowed); hover only pauses it
  const animations = new Set();
  const stopTour = () => {
    if (tourStart !== null) {
      clearTimeout(tourStart);
      tourStart = null;
    }
    if (tour !== null) {
      clearInterval(tour);
      tour = null;
    }
  };
  const stopAnimations = () => {
    stopTour();
    // Child teardown can remove the chips before this component's cleanup.
    // Keep animation handles so detached chips are cancelled too.
    animations.forEach((animation) => animation.cancel());
    animations.clear();
  };

  const current = () => FRAMEWORKS.find((f) => f.id === selected) ?? FRAMEWORKS[0];

  const animate = (el, frames, opts) => {
    if (el && typeof el.animate === "function") {
      const animation = el.animate(frames, opts);
      animations.add(animation);
      animation.onfinish = () => animations.delete(animation);
      animation.oncancel = () => animations.delete(animation);
    }
  };

  // Flash only runtime chips, in order, after a state change.
  const playStack = (panel) => {
    const root = rootRef;
    if (!root) return;
    root.querySelectorAll(`[data-pl="${panel}"] [data-phase="update"] .pipe-chip`).forEach((el, i) => {
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

  const resumeTour = () => {
    if (touring && tour === null) tour = setInterval(tourStep, 3400);
  };

  onMediaQuery("(prefers-reduced-motion: reduce)", (reduced) => {
    stopTour();
    touring = !reduced;
    if (reduced) {
      stopAnimations();
      return;
    }
    // Opening pass on React, then tour every framework in turn.
    tourStart = setTimeout(() => {
      tourStart = null;
      play();
    }, 800);
    tour = setInterval(tourStep, 3400);
  });
  onCleanup(stopAnimations);

  return (
    <div ref={rootRef} onmouseenter={stopTour} onmouseleave={resumeTour}>
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
            <p className="pipe-mode">{current().mode}</p>
            <div className="pipe-phase" data-phase="build">
              <h2 className="pipe-phase-label">Build time</h2>
              {current().build.map((l) => (
                <div key={l.label} className="pipe-chip">
                  <svg className="pipe-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <use href={"#pi-" + l.icon} />
                  </svg>
                  {l.label}
                </div>
              ))}
            </div>
            <div className="pipe-phase" data-phase="update">
              <h2 className="pipe-phase-label">On state change</h2>
              {current().updates.map((l) => (
                <div key={l.label} className="pipe-chip">
                  <svg className="pipe-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <use href={"#pi-" + l.icon} />
                  </svg>
                  {l.label}
                </div>
              ))}
            </div>
            <p className="pipe-note">{current().note}</p>
            <a className="pipe-source" href={current().source}>Official docs →</a>
          </div>
          <div className="pipe-vs" aria-hidden="true">
            vs
          </div>
          <div className="pipe-stack is-ours" data-pl="right">
            <div className="pipe-stack-head">
              <img className="pipe-logo" src={OTF.logo} alt="" width="18" height="18" loading="lazy" />
              {OTF.name}
            </div>
            <p className="pipe-mode">{OTF.mode}</p>
            <div className="pipe-phase" data-phase="build">
              <h2 className="pipe-phase-label">Build time</h2>
              {OTF.build.map((l) => (
                <div key={l.label} className="pipe-chip">
                  <svg className="pipe-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <use href={"#pi-" + l.icon} />
                  </svg>
                  {l.label}
                </div>
              ))}
            </div>
            <div className="pipe-phase" data-phase="update">
              <h2 className="pipe-phase-label">On state change</h2>
              {OTF.updates.map((l) => (
                <div key={l.label} className="pipe-chip">
                  <svg className="pipe-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <use href={"#pi-" + l.icon} />
                  </svg>
                  {l.label}
                </div>
              ))}
            </div>
            <p className="pipe-note">{OTF.note}</p>
            <a className="pipe-source" href={OTF.source}>Reactivity docs →</a>
          </div>
        </div>
        <p className="pipe-caption">Simplified client-side update paths. Build steps stay static; animation speed and step counts do not represent performance. Hover to pause the tour.</p>
      </div>
    </div>
  );
}
