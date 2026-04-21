export default function ListRendering(props) {
  let items = $state(['A', 'B', 'C']);
  
  return (
    <div>
      <ul>
        {items.map(item => (
          <li>Item {item}</li>
        ))}
      </ul>
      <button onclick={() => items = [...items, 'D']}>
        Add
      </button>
    </div>
  );
}
