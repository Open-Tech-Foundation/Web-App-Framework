import Counter from "../components/Counter"

export default function Page() {

  return (
    <div>
      <h1>Home Page</h1>
      <Counter label="Increment" />
      <Counter label="Increment 2" />
    </div>
  )
}
