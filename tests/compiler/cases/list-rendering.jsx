export default function ListRendering(props) {
  const items = $state(['A', 'B', 'C']);
  
  return (
    <div>
      <ul>
        {items.value.map(item => (
          <li>Item {item}</li>
        ))}
      </ul>
      <button onclick={() => items.value = [...items.value, 'D']}>
        Add
      </button>
    </div>
  );
}
