// Live output for the "Lists" section.

const frame = "demo-output demo-output--jsx";

export default function ListDemo() {
  let items = $state([
    { id: "a", text: "Write JSX guide" },
    { id: "b", text: "Ship compiler fix" },
    { id: "c", text: "Update docs" },
  ]);

  const add = () => {
    const id = String(Date.now());
    items = [...items, { id, text: `New item ${items.length + 1}` }];
  };

  const remove = (id) => {
    items = items.filter((item) => item.id !== id);
  };

  return (
    <div class={frame}>
      <span class="demo-output-label">Output</span>
      <div class="demo-jsx-stack">
        <ul class="demo-jsx-list">
          {items.map((item) => (
            <li key={item.id} class="demo-jsx-list-item">
              <span>{item.text}</span>
              <button onclick={() => remove(item.id)} class="demo-jsx-btn demo-jsx-btn--ghost demo-jsx-btn--sm">
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button onclick={add} class="demo-jsx-btn">
          Add item
        </button>
      </div>
    </div>
  );
}