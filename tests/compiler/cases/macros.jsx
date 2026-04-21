export default function MacroTest() {
  let count = $state(0);
  const doubled = $derived(() => count * 2);
  
  $effect(() => {
    console.log("Count changed:", count);
  });

  return (
    <div>
      <p>Count: {count}</p>
      <p>Doubled: {doubled}</p>
      <button onclick={() => count++}>Increment</button>
    </div>
  );
}
