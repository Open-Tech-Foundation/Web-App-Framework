import { createForm } from "@opentf/web-form";

export default function FormCase() {
  const form = createForm({ initialValues: { name: "Alice" } });

  return (
    <div>
      <input {...form.register('name')} />
      <p>Hello, {form.values.name}</p>
      <button onclick={form.handleSubmit((v) => console.log(v))}>
        Submit
      </button>
    </div>
  );
}
