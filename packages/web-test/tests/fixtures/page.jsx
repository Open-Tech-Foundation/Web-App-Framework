import { onMount, onCleanup } from '@opentf/web';
export default function Page(props) {
  onMount(() => props.onStart?.());
  onCleanup(() => props.onDispose?.());
  return <h1>Hello {props.name}</h1>;
}
