// Live output for the "Text and expressions" section.

const frame = "demo-output demo-output--jsx";

export default function ExpressionDemo() {
  let name = $state("Ada");
  let count = $state(3);

  return (
    <div class={frame}>
      <span class="demo-output-label">Output</span>
      <div class="demo-jsx-stack">
        <p class="demo-jsx-line">
          Hello, <strong>{name}</strong> — you have <em>{count}</em> messages.
        </p>
        <div class="demo-jsx-controls">
          <input
            value={name}
            oninput={(e) => (name = e.target.value)}
            placeholder="Name"
            class="demo-jsx-input"
          />
          <button onclick={() => count++} class="demo-jsx-btn">
            +1 message
          </button>
        </div>
      </div>
    </div>
  );
}