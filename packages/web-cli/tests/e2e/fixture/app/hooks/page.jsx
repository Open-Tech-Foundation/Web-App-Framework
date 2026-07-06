import HookProbe from "../HookProbe";

export default function HooksPage() {
  let mode = $state("unknown");

  onMount(() => (window.__hookLog ??= []).push("mount"));

  onMediaQuery("(max-width: 700px)", (matches) => {
    mode = matches ? "compact" : "wide";
    (window.__hookLog ??= []).push(`page-mq:${matches}`);
  });

  onResize((entry) => {
    (window.__hookLog ??= []).push(`page-resize:${Math.round(entry.contentRect.width)}`);
  });

  return (
    <main class="hooks-page">
      <h1>E2E_HOOKS</h1>
      <p class="mq-mode">{mode}</p>
      <div style={{ height: "150vh" }}>spacer</div>
      <HookProbe />
    </main>
  );
}
