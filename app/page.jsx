import Counter from "../components/Counter.wc.jsx"
import Link from "../components/Link.wc.jsx"

export default function Page() {
  return (
    <div>
      <h1>WAF Framework</h1>
      <p>Using the new .wc.jsx convention</p>
      <Counter label="Increment 1" />
      <Counter label="Increment 2" />
      <hr />
      <Link href="/about">Go to About</Link>
    </div>
  )
}
