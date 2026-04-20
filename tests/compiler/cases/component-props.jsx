export default function Parent() {
  const count = $state(0);
  return (
    <div>
      <Child val={count.value} />
      <button onclick={() => count.value++}>Inc</button>
    </div>
  );
}

function Child({ val }) {
  return <div>{val}</div>;
}
