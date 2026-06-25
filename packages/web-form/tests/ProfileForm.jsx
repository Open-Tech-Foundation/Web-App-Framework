import { createForm } from "../index.js";

export default function ProfileForm() {
  const form = createForm({
    initialValues: {
      user: { name: "John" },
      tags: ["js"]
    },
    validate: (v) => {
      const errors = {};
      if (v.user.name.length < 3) errors.user = { name: "Too short" };
      return errors;
    }
  });

  const addTag = () => form.values.tags.push(`tag-${form.values.tags.length}`);

  return (
    <div>
      <h1 data-testid="title">{form.values.user.name}</h1>
      <input {...form.register("user.name")} data-testid="name-input" />
      <div data-testid="name-error">{form.errors.user?.name}</div>

      <ul data-testid="tag-list">
        {form.values.tags.map((tag, i) => (
          <li data-testid={`tag-${i}`}>{tag}</li>
        ))}
      </ul>
      <button onclick={addTag} data-testid="add-tag">Add Tag</button>

      <div data-testid="status">{form.isValid ? "Valid" : "Invalid"}</div>
    </div>
  );
}
