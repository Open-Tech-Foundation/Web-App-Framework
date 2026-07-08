// Live output for the "Conditionals" section.

const frame = "demo-output demo-output--jsx";

export default function ConditionalDemo() {
  let loggedIn = $state(false);
  let showBanner = $state(true);

  return (
    <div class={frame}>
      <span class="demo-output-label">Output</span>
      <div class="demo-jsx-stack">
        {showBanner && (
          <p class="demo-jsx-banner">Welcome back — session is active.</p>
        )}
        {loggedIn ? (
          <p class="demo-jsx-line">You are signed in.</p>
        ) : (
          <p class="demo-jsx-line demo-jsx-muted">Please sign in to continue.</p>
        )}
        <div class="demo-jsx-controls">
          <button onclick={() => (loggedIn = !loggedIn)} class="demo-jsx-btn">
            Toggle signed in
          </button>
          <button onclick={() => (showBanner = !showBanner)} class="demo-jsx-btn demo-jsx-btn--ghost">
            Toggle banner
          </button>
        </div>
      </div>
    </div>
  );
}