import { createForm } from "@opentf/web-form";

// A compact, self-contained live form embedded in the docs. Plain-function
// validator (no extra deps), onBlur validation, and a field error shown only
// once the user engages the field.

const fieldCls = (err) =>
  "w-full px-3 py-2.5 rounded-lg border bg-slate-900/50 text-white text-sm outline-none transition-all " +
  (err ? "border-red-500/60 bg-red-500/5" : "border-slate-700/60 focus:border-indigo-500/60");

const at = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const shown = (form, path) =>
  at(form.errors, path) && (at(form.values, path) || at(form.touched, path)) ? at(form.errors, path) : null;

export default function LiveForm() {
  const form = createForm({
    mode: "onBlur",
    initialValues: { name: "", email: "" },
    validate: (v) => {
      const e = {};
      if (v.name.trim().length < 2) e.name = "Name must be at least 2 characters";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) e.email = "Enter a valid email";
      return e;
    },
  });

  const onSubmit = async (values) => {
    await new Promise((r) => setTimeout(r, 900));
    console.log("submitted", values);
  };

  return (
    <div class="not-prose my-6 grid sm:grid-cols-[1fr_240px] gap-4 rounded-2xl border border-slate-700/50 bg-slate-800/20 p-5">
      <form onsubmit={form.handleSubmit(onSubmit)} class="space-y-3">
        <div>
          <input {...form.register("name")} placeholder="Name" class={fieldCls(shown(form, "name"))} />
          {shown(form, "name") && <span class="text-[11px] text-red-400 font-semibold">{shown(form, "name")}</span>}
        </div>
        <div>
          <input {...form.register("email")} placeholder="you@example.com" class={fieldCls(shown(form, "email"))} />
          {shown(form, "email") && <span class="text-[11px] text-red-400 font-semibold">{shown(form, "email")}</span>}
        </div>
        <div class="flex gap-2 pt-1">
          <button type="button" onclick={() => form.reset()} class="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold">Reset</button>
          <button type="submit" disabled={!form.isValid || form.isSubmitting} class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed">
            {form.isSubmitting ? "Submitting…" : form.isSubmitted ? "Submitted ✓" : "Submit"}
          </button>
        </div>
      </form>

      <aside class="rounded-xl bg-slate-950/70 border border-slate-800/60 p-3">
        <div class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Live state</div>
        <pre class="text-[10px] font-mono text-indigo-300/80 leading-relaxed overflow-auto">{JSON.stringify({ values: form.values, valid: form.isValid, dirty: form.isChanged }, null, 1)}</pre>
      </aside>
    </div>
  );
}
