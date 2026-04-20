import { signal } from "@preact/signals"

export default function SvgTest() {
  const strokeWidth = signal(2)
  
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle 
        cx="50" 
        cy="50" 
        r="40" 
        stroke="red" 
        strokeWidth={strokeWidth.value} 
        fill="transparent"
      />
      <path 
        d="M 10 10 L 90 90" 
        stroke="blue" 
        strokeLinecap="round"
      />
    </svg>
  )
}
