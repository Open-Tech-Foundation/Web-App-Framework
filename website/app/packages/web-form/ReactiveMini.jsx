import { createForm } from "@opentf/web-form";

// Mini demo for the "Reactive state" section: typing into the field updates the
// live read of `form.values.name` with no re-render — only the bound nodes change.

const frame = "not-prose mt-4 mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const label = "block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1";
const field = "w-full px-3 py-2 rounded-lg border bg-[var(--bg-main)] text-[var(--text-main)] text-sm outline-none border-[var(--border)] focus:border-indigo-500/60 transition-all";

export default function ReactiveMini() {
  const form = createForm({
    initialValues: { name: "" },
  });

  return (
    <div class={frame}>
      <div class={tag}>
        <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>Live demo
      </div>
      <div class="mt-3 grid sm:grid-cols-2 gap-4 items-end">
        <div>
          <label class={label}>Your name</label>
          <input {...form.register("name")} placeholder="Start typing…" class={field} />
        </div>
        <div class="rounded-lg bg-[var(--bg-main)] border border-[var(--border)] p-3">
          <div class="text-[10px] font-mono text-[var(--text-muted)]">form.values.name</div>
          <div class="text-lg font-black text-[var(--text-main)] mt-0.5">
            Hello, {form.values.name || "stranger"} 👋
          </div>
        </div>
      </div>
    </div>
  );
}
