export default function StyleTest() {
  let color = $state("red")
  
  return (
    <div style={{ display: "flex", gap: "10px" }}>
      <span style={{ color: color }}>
        Reactive Style
      </span>
      <div style="font-weight: bold;">
        Static Style String
      </div>
    </div>
  )
}
