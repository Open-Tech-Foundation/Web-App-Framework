import Stepper from "./Stepper.jsx";

export default function Home() {
  let count = $state(0);
  return (
    <main>
      <h1>E2E_HOME</h1>
      <p>count {count}</p>
      <button onclick={() => count++}>inc</button>
      <Stepper config={{ label: "Steps" }} />
    </main>
  );
}
