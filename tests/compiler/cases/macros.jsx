export default function MacroTest() {
  const count = $state(0);
  const doubled = $derived(() => count.value * 2);
  
  $effect(() => {
    console.log("Count changed:", count.value);
  });

  return (
    <div>
      <p>Count: {count.value}</p>
      <p>Doubled: {doubled.value}</p>
      <button onclick={() => count.value++}>Increment</button>
    </div>
  );
}
