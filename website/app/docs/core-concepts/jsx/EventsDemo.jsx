// Live output for the "Event handlers" section.

const frame = "demo-output demo-output--jsx";

export default function EventsDemo() {
  let clicks = $state(0);
  let lastKey = $state("—");

  return (
    <div class={frame}>
      <span class="demo-output-label">Output</span>
      <div class="demo-jsx-stack">
        <button onclick={() => clicks++} class="demo-jsx-btn">
          Clicked {clicks} {clicks === 1 ? "time" : "times"}
        </button>
        <input
          onkeydown={(e) => (lastKey = e.key)}
          placeholder="Type a key…"
          class="demo-jsx-input"
        />
        <p class="demo-jsx-line demo-jsx-muted">
          Last key: <code class="demo-jsx-code">{lastKey}</code>
        </p>
      </div>
    </div>
  );
}