import { signal } from "@preact/signals"

export default function Reactivity(props) {
  let count = $state(0)
  return (
    <div title={props.title}>
      <span>{count}</span>
      <button onclick={() => count++}>Add</button>
    </div>
  )
}
