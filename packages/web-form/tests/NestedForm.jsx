import { createForm } from "../index.js";

export default function NestedForm({ onSubmit }) {
  const form = createForm({
    initialValues: {
      user: {
        profile: { firstName: "John" },
        settings: { notifications: true }
      }
    }
  });

  return (
    <div>
      <input 
        {...form.register("user.profile.firstName")} 
        data-testid="first-name" 
      />
      <input 
        type="checkbox"
        {...form.register("user.settings.notifications")} 
        data-testid="notifications" 
      />
      <button 
        onclick={form.handleSubmit(onSubmit)} 
        data-testid="submit"
      >
        Submit
      </button>
    </div>
  );
}
