import { navigate } from "./index"

export default function Link(props) {
  return (
    <a
      href={props.href}
      className={props.className || 'hover:text-accent transition-colors'}
      style={{ cursor: 'pointer', textDecoration: 'none', display: 'inline-block', ...props.style }}
      onclick={(e) => {
        console.log('Link clicked:', props.href);
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0
        ) return

        e.preventDefault()
        window._isProgrammaticScroll = true;
        navigate(props.href)
        setTimeout(() => window._isProgrammaticScroll = false, 1000);
      }}
    >
      {props.children}
    </a>
  )
}
