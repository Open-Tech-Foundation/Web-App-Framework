import { createForm } from "@opentf/web-form";

// Mini demo for the "Status flags" section: edit/blur/submit and watch the
// derived flags flip live. `onChange` mode keeps `isValid` accurate as you type.

const frame = "not-prose mt-4 mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const label = "block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1";
const field = "w-full px-3 py-2 rounded-lg border bg-[var(--bg-main)] text-[var(--text-main)] text-sm outline-none border-[var(--border)] focus:border-indigo-500/60 transition-all";
const btn = "px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 disabled:shadow-none";
const on = "px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30";
const off = "px-2.5 py-1 rounded-full text-[11px] font-bold text-[var(--text-muted)] border border-[var(--border)]";

export default function StatusMini() {
  const form = createForm({
    initialValues: { email: "" },
    mode: "onChange",
    validate: (v) => (v.email.includes("@") ? {} : { email: "Enter a valid email" }),
  });

  const onSubmit = async () => {
    await new Promise((r) => setTimeout(r, 700));
  };

  return (
    <div class={frame}>
      <div class={tag}>
        <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>Live demo
      </div>
      <form onsubmit={form.handleSubmit(onSubmit)} class="mt-3 space-y-3">
        <div>
          <label class={label}>Email</label>
          <input {...form.register("email")} type="email" placeholder="you@example.com" class={field} />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class={form.isValid ? on : off}>isValid</span>
          <span class={form.isChanged ? on : off}>isChanged</span>
          <span class={form.isTouched ? on : off}>isTouched</span>
          <span class={form.isSubmitting ? on : off}>isSubmitting</span>
          <span class={form.isSubmitted ? on : off}>isSubmitted</span>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold text-[var(--text-muted)] border border-[var(--border)]">
            submitCount: {form.submitCount}
          </span>
        </div>
        <button type="submit" disabled={form.isSubmitting} class={btn}>
          {form.isSubmitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </div>
  );
}
