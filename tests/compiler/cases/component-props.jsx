export default function Parent() {
  let count = $state(0);
  return (
    <div>
      <Child val={count} />
      <button onclick={() => count++}>Inc</button>
    </div>
  );
}

function Child({ val }) {
  return <div>{val}</div>;
}
