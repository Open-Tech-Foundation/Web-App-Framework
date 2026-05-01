import { createForm } from "@opentf/web-form";

export function BasicForm() {
  const form = createForm({ initialValues: { username: "" } });
  
  const isValid = $derived(form.isValid);
  const isSubmitting = $derived(form.isSubmitting);
  const canSubmit = $derived(isValid && !isSubmitting);

  return (
    <section>
      <button 
        type="submit" 
        disabled={() => !canSubmit} 
      >
        {() => isSubmitting ? "Processing..." : "Save Changes"}
      </button>
    </section>
  );
}
