import { signal } from "@preact/signals"

export default function Counter(props) {
  const count = signal(0)

  onMount(() => {
    console.log(`Counter "${props.label}" mounted!`)
  })

  onCleanup(() => {
    console.log(`Counter "${props.label}" cleaned up!`)
  })

  return (
    <div>
      {count.value} <button onclick={(e) => {
        count.value++
      }}>
        {props.label}
      </button>
    </div>
  )
}
