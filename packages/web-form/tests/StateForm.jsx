import { createForm } from "../index.js";

export default function StateForm({ onSubmit }) {
  const form = createForm({
    mode: "onChange", // Use onChange for easier testing of reactive text
    initialValues: { username: "alice" },
    validate: (v) => v.username.length < 3 ? { username: "Too short" } : {}
  });

  return (
    <form onsubmit={form.handleSubmit(onSubmit)}>
      <input {...form.register("username")} data-testid="username" />

      <div data-testid="status-valid">{form.isValid ? "Valid" : "Invalid"}</div>
      <div data-testid="status-changed">{form.isChanged ? "Changed" : "Unchanged"}</div>
      <div data-testid="status-touched">{form.isTouched ? "Touched" : "Untouched"}</div>

      {form.errors.username && <span data-testid="error">{form.errors.username}</span>}

      <button type="button" onclick={() => form.reset()} data-testid="reset">Reset</button>
      <button type="submit" data-testid="submit">Submit</button>

      {form.isSubmitted && <div data-testid="success">Submitted!</div>}
    </form>
  );
}
