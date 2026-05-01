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
      <div>The count is: {count}</div>
      <button onclick={(e) => { count++ }} className="btn border border-black cursor-pointer mx-2 px-2 py-1 rounded-lg">
        {props.label}
      </button>
    </div>
  )
}

