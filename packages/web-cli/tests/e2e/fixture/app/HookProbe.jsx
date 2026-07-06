export default function HookProbe() {
  let w = $state(0);
  let seen = $state("no");

  onResize((entry) => {
    w = Math.round(entry.contentRect.width);
    (window.__hookLog ??= []).push(`box-resize:${Math.round(entry.contentRect.width)}`);
  });

  onVisibilityChange((visible) => {
    if (visible) seen = "yes";
    (window.__hookLog ??= []).push(`box-visible:${visible}`);
  });

  return (
    <div class="hook-box">
      <span class="box-w">{w}</span>
      <span class="box-seen">{seen}</span>
    </div>
  );
}
