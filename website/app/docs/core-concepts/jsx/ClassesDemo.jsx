// Live output for the "Class names" section.

const frame = "demo-output demo-output--jsx";

export default function ClassesDemo() {
  let active = $state(true);
  let danger = $state(false);

  return (
    <div class={frame}>
      <span class="demo-output-label">Output</span>
      <div class="demo-jsx-stack">
        <span
          class={[
            "demo-jsx-badge",
            active ? "demo-jsx-badge--active" : "demo-jsx-badge--idle",
            { "demo-jsx-badge--danger": danger },
          ]}
        >
          {active ? "Active" : "Idle"}
          {danger ? " · alert" : ""}
        </span>
        <div class="demo-jsx-controls">
          <button onclick={() => (active = !active)} class="demo-jsx-btn">
            Toggle active
          </button>
          <button onclick={() => (danger = !danger)} class="demo-jsx-btn demo-jsx-btn--ghost">
            Toggle alert
          </button>
        </div>
      </div>
    </div>
  );
}