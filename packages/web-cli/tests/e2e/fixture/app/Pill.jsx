// The component's *root* is a conditional, which lowers to a Fragment. The adopt walk
// must flatten that root and claim the rendered branch (hydrateChild) rather than fall
// back to a destroy-and-rebuild.
export default function Pill({ on }) {
  return on ? <b class="pill-on">ON</b> : <i class="pill-off">OFF</i>;
}
