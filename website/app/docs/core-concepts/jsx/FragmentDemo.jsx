// Live output for the "Fragments" section.

const frame = "demo-output demo-output--jsx";

export default function FragmentDemo() {
  let showExtra = $state(true);

  return (
    <div class={frame}>
      <span class="demo-output-label">Output</span>
      <div class="demo-jsx-stack">
        <div class="demo-jsx-fragment-row">
          <>
            <span class="demo-jsx-chip">One</span>
            <span class="demo-jsx-chip">Two</span>
            {showExtra && <span class="demo-jsx-chip demo-jsx-chip--accent">Three</span>}
          </>
        </div>
        <button onclick={() => (showExtra = !showExtra)} class="demo-jsx-btn">
          Toggle third chip
        </button>
      </div>
    </div>
  );
}