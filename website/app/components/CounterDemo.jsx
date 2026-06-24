// The live, running output for the "A first component" snippet in the docs intro.
// It is the exact Counter from that code block — compiled to a real Custom Element —
// shown inside an "Output" frame so the reader sees what the code produces.
export default function CounterDemo() {
  let count = $state(0);

  return (
    <div className="demo-output">
      <span className="demo-output-label">Output</span>
      <button className="demo-counter" onclick={() => count++}>
        Clicked {count} times
      </button>
    </div>
  );
}
