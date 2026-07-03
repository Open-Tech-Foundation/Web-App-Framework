// A standalone interactive component (Custom Element) used by the home page — the
// canonical hydration "island". Server-rendered with its count at 7; on hydrate its
// connectedCallback must adopt the existing nodes (isHydrating() && this.firstChild) and
// wire the signal onto them, not rebuild.
//
// It also takes a **rich object prop** `config={{ label }}` — the compiler-driven data
// hydration path: `ssgComponent` records the object in the serialized payload (keyed by the
// host's `data-h` id) rather than stamping a lossy string attribute, and this component's
// constructor initializes its prop signal from that real object at upgrade. The e2e asserts
// `config.label` survives hydration and there is no `config=` attribute on the host.
export default function Stepper({ config }) {
  let n = $state(7);
  return (
    <button class="stepper" onclick={() => n++}>
      {config.label} n={n}
    </button>
  );
}
