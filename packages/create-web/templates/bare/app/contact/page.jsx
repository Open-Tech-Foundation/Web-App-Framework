import { createForm } from "@opentf/web-form";

// A live form built with @opentf/web-form. Fields bind by path string, the small
// validator runs on blur and on submit, and `form.reset()` clears it afterwards.
export default function Contact() {
  let sent = $state(false);

  const form = createForm({
    initialValues: { name: "", email: "", message: "" },
    validate: (v) => {
      const errors = {};
      if (!v.name.trim()) errors.name = "Please enter your name";
      if (!v.email.includes("@")) errors.email = "Enter a valid email";
      if (v.message.trim().length < 10) errors.message = "Message must be at least 10 characters";
      return errors;
    },
  });

  const onSubmit = async (values) => {
    await new Promise((r) => setTimeout(r, 600)); // pretend to POST
    console.log("Submitted:", values);
    sent = true;
    form.reset();
  };

  return (
    <section class="card">
      <h1 class="title">Contact</h1>
      <p class="lead">
        A live form built with <code class="code">@opentf/web-form</code> — signal-bound
        fields, path-based state, and a tiny validator.
      </p>

      <form class="form" onsubmit={form.handleSubmit(onSubmit)}>
        <div class="field">
          <label class="label">Name</label>
          <input class="input" {...form.register("name")} placeholder="Ada Lovelace" />
          {form.touched.name && form.errors.name ? <span class="error">{form.errors.name}</span> : null}
        </div>

        <div class="field">
          <label class="label">Email</label>
          <input class="input" type="email" {...form.register("email")} placeholder="ada@example.com" />
          {form.touched.email && form.errors.email ? <span class="error">{form.errors.email}</span> : null}
        </div>

        <div class="field">
          <label class="label">Message</label>
          <textarea class="input" rows="4" {...form.register("message")} placeholder="Say hello…"></textarea>
          {form.touched.message && form.errors.message ? <span class="error">{form.errors.message}</span> : null}
        </div>

        <button class="btn" type="submit" disabled={form.isSubmitting}>
          {form.isSubmitting ? "Sending…" : "Send message"}
        </button>

        {sent ? <p class="success">✓ Thanks! Your message was sent.</p> : null}
      </form>
    </section>
  );
}
