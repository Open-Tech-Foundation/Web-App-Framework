import { signal } from "@preact/signals"

export default function Counter(props) {
  const count = signal(0)

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
