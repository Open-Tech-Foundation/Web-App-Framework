import { signal } from "@preact/signals"

export default function StylingTest(props) {
  const active = signal(true)
  
  return (
    <div class="static-class" className="static-classname">
      <span class={active.value ? "active" : "inactive"}>
        Reactive Class
      </span>
      <button className={props.theme}>
        Reactive ClassName from Props
      </button>
    </div>
  )
}
