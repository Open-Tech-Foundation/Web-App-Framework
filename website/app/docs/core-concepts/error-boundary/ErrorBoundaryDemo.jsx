// Live demo for the ErrorBoundary guide — throw, catch, fix, retry.

import { ErrorBoundary } from "@opentf/web";

function RiskyChip({ armed }) {
  if (armed) {
    throw new Error("Render failed — fix the cause, then Retry.");
  }
  return <span class="demo-eb-ok">Component recovered.</span>;
}

export default function ErrorBoundaryDemo() {
  let armed = $state(true);

  return (
    <div class="demo-output demo-output--eb">
      <span class="demo-output-label">Output</span>
      <div class="demo-eb-stack">
        <ErrorBoundary fallback={(error) => `Caught: ${error.message}`}>
          <RiskyChip armed={armed} />
        </ErrorBoundary>
        <button type="button" class="demo-eb-btn" onclick={() => (armed = false)}>
          Fix the error
        </button>
        <p class="demo-eb-hint">
          Click <strong>Fix the error</strong>, then <strong>Retry</strong> in the fallback
          above.
        </p>
      </div>
    </div>
  );
}