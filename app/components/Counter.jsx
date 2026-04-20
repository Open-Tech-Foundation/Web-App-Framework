export default function Counter(props) {
  const count = $state(0)

  const doubled = $derived(() => count.value * 2);

  $effect(() => console.log(doubled.value));

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

