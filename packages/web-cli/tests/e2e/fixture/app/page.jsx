import Stepper from "./Stepper.jsx";

export default function Home() {
  let count = $state(0);
  let items = $state([1, 2, 3]);
  return (
    <main>
      <h1>E2E_HOME</h1>
      <p>count {count}</p>
      <button onclick={() => count++}>inc</button>
      <Stepper config={{ label: "Steps" }} />
      <button class="add" onclick={() => (items = [...items, items.length + 1])}>add</button>
      <ul class="items">
        {items.map((x) => (
          <li>item {x}</li>
        ))}
      </ul>
    </main>
  );
}
