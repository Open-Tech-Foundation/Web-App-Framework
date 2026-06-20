import { navigate, router } from "./index.js"

export default function Link(props) {
  return (
    <a
      href={props.href}
      className={props.className}
      style={props.style}
      onclick={(e) => {
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0
        ) return

        // Respect the navigation mode from the config
        if (router.config.navigation === "mpa") return;

        // If Navigation API is supported, let it handle the interception globally.
        // Otherwise, fallback to manual navigation.
        if (!window.navigation) {
          e.preventDefault()
          navigate(props.href)
        }
        window.scrollTo(0, 0)
      }}
    >
      {props.children}
    </a>
  )
}
