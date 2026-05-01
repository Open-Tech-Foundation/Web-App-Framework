import { createForm } from "../index.js";

export default function DynamicArrayForm() {
  const form = createForm({
    initialValues: { items: ["Item 1"] }
  });

  const addItem = () => {
    const items = form.values.items;
    form.values.items = [...items, `Item ${items.length + 1}`];
  };

  const removeItem = (index) => {
    const newItems = [...form.values.items];
    newItems.splice(index, 1);
    form.values.items = newItems;
  };

  return (
    <div>
      <button onclick={addItem} data-testid="add-item">Add Item</button>
      <ul data-testid="item-list">
        {form.values.items.map((item, index) => (
          <li data-testid={`item-${index}`}>
            {item}
            <button onclick={() => removeItem(index)} data-testid={`remove-${index}`}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
