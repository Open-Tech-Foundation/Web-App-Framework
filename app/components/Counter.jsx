export default function Counter(props) {
  let count = $state(0)

  const doubled = $derived(() => count * 2);

  $effect(() => console.log(doubled));

  onMount(() => {
    console.log(`Counter "${props.label}" mounted!`)
  })

  onCleanup(() => {
    console.log(`Counter "${props.label}" cleaned up!`)
  })

  return (
    <div>
      {count} <button onclick={(e) => {
        count++
      }}>
        {props.label}
      </button>
    </div>
  )
}

