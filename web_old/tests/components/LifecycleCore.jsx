import { onMount, onCleanup } from "@opentf/web";

export function LifecycleCore({ onEvent }) {
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
    onEvent("mounted");
  });

  onCleanup(() => {
    onEvent("cleaned");
  });

  return (
    <div data-testid="lifecycle-root">
      {mounted ? "Status: Active" : "Status: Waiting"}
    </div>
  );
}
