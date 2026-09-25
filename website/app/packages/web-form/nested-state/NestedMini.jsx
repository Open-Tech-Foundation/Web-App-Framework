import { createForm } from "@opentf/web-form";

// Mini demo for the Nested State page: a nested `profile` object plus a dynamic
// `tags` array addressed by dotted paths, with a live JSON view of the tree.

const frame = "not-prose mt-4 mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const label = "block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1";
const field = "w-full px-3 py-2 rounded-lg border bg-[var(--bg-main)] text-[var(--text-main)] text-sm outline-none border-[var(--border)] focus:border-indigo-500/60 transition-all";
const btnSoft = "px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--border)] text-[var(--text-main)] hover:border-indigo-400 hover:text-indigo-500 transition-all";

export default function NestedMini() {
  const form = createForm({
    initialValues: {
      profile: { firstName: "Ada", lastName: "Lovelace" },
      tags: ["pilot"],
    },
  });

  const addTag = () => form.values.tags.push("");
  const removeTag = (i) => form.values.tags.splice(i, 1);

  return (
    <div class={frame}>
      <div class={tag}>
        <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>Live demo
      </div>
      <div class="mt-3 grid lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class={label}>profile.firstName</label>
              <input {...form.register("profile.firstName")} class={field} />
            </div>
            <div>
              <label class={label}>profile.lastName</label>
              <input {...form.register("profile.lastName")} class={field} />
            </div>
          </div>
          <div>
            <label class={label}>tags[]</label>
            <div class="space-y-2">
              {form.values.tags.map((_, i) => (
                <div class="flex items-center gap-2">
                  <input {...form.register(`tags.${i}`)} placeholder={`tags.${i}`} class={field} />
                  <button type="button" onclick={() => removeTag(i)} class="shrink-0 w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-red-500 hover:border-red-400 transition-all">✕</button>
                </div>
              ))}
            </div>
            <div class="flex items-center gap-2 mt-2">
              <button type="button" onclick={addTag} class={btnSoft}>＋ Add tag</button>
              <button type="button" onclick={() => form.reset()} class={btnSoft}>Reset</button>
            </div>
          </div>
        </div>
        <pre class="rounded-lg bg-[var(--code-bg)] text-slate-300 text-[11px] font-mono p-3 overflow-auto max-h-[260px] leading-relaxed">{JSON.stringify(form.values, null, 2)}</pre>
      </div>
    </div>
  );
}
