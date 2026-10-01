import { onCleanup } from '@opentf/web';
export default function Counter(props) {
  let count = $state(props.initial ?? 0);
  onCleanup(() => props.onDispose?.());
  return <button type="button" data-testid="counter" onclick={() => count++}>Count: {count}</button>;
}
