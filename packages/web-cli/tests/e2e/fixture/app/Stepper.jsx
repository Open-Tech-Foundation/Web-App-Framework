// A standalone interactive component (Custom Element) used by the home page — the
// canonical hydration "island". Server-rendered with its count at 7; on hydrate its
// connectedCallback must adopt the existing nodes (this.firstChild) and wire the
// signal onto them, not rebuild.
export default function Stepper() {
  let n = $state(7);
  return (
    <button class="stepper" onclick={() => n++}>
      n={n}
    </button>
  );
}
