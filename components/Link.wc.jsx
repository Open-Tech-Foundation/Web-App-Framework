import { navigate } from "../framework/router/index"

export default function Link(props) {
  return (
    <a 
      href={props.href} 
      onclick={(e) => {
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0
        ) return

        e.preventDefault()
        navigate(props.href)
      }}
    >
    </a>
  )
}
