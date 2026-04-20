import { signal } from "@preact/signals"

export default function StyleTest() {
  const color = signal("red")
  
  return (
    <div style={{ display: "flex", gap: "10px" }}>
      <span style={{ color: color.value }}>
        Reactive Style
      </span>
      <div style="font-weight: bold;">
        Static Style String
      </div>
    </div>
  )
}
