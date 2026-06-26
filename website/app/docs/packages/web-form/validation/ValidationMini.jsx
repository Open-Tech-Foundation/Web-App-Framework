import { createForm } from "@opentf/web-form";

// Mini demo for the Validation page: a two-field validator with a live `mode`
// knob so you can feel the difference between onBlur / onChange / onSubmit.

const frame = "not-prose mt-4 mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const label = "block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1";
const field = "w-full px-3 py-2 rounded-lg border bg-[var(--bg-main)] text-[var(--text-main)] text-sm outline-none border-[var(--border)] focus:border-indigo-500/60 transition-all";
const btn = "px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 disabled:shadow-none";
const knobOn = "px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/15 text-indigo-500 border border-indigo-500 ring-1 ring-indigo-500/30 transition-all";
const knobOff = "px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--text-muted)] border border-[var(--border)] hover:border-indigo-400/60 transition-all";

const MODES = ["onBlur", "onChange", "onSubmit"];

export default function ValidationMini() {
  let mode = $state("onBlur");
  let done = $state(false);

  const form = createForm({
    initialValues: { email: "", age: "" },
    mode: "onBlur",
    validate: (v) => {
      const e = {};
      if (!String(v.email).includes("@")) e.email = "Enter a valid email";
      if (!(Number(v.age) >= 18)) e.age = "Must be 18 or older";
      return e;
    },
  });

  const setMode = (m) => {
    mode = m;
    form._updateConfig(m, "onChange");
  };

  // Show an error only once the user has engaged the field: by typing in
  // onChange mode, or by blurring in onBlur / onSubmit modes.
  const show = (name) => {
    const err = form.errors[name];
    if (!err) return null;
    const engaged = mode === "onChange" ? !!form.values[name] : !!form.touched[name];
    return engaged ? err : null;
  };

  const onSubmit = async () => {
    done = true;
    setTimeout(() => (done = false), 1500);
  };

  return (
    <div class={frame}>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class={tag}>
          <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>Live demo
        </div>
        <div class="flex items-center gap-1.5">
          {MODES.map((m) => (
            <button type="button" onclick={() => setMode(m)} class={mode === m ? knobOn : knobOff}>{m}</button>
          ))}
        </div>
      </div>
      <form onsubmit={form.handleSubmit(onSubmit)} class="mt-3 space-y-3">
        <div>
          <label class={label}>Email</label>
          <input {...form.register("email")} type="email" placeholder="you@example.com" class={field} />
          {show("email") && <span class="text-[11px] text-red-500 font-bold">{show("email")}</span>}
        </div>
        <div>
          <label class={label}>Age</label>
          <input {...form.register("age")} type="number" placeholder="18" class={field} />
          {show("age") && <span class="text-[11px] text-red-500 font-bold">{show("age")}</span>}
        </div>
        <div class="flex items-center gap-3 pt-1">
          <button type="submit" class={btn}>Submit</button>
          {done && <span class="text-sm font-bold text-emerald-600">✓ Passed validation</span>}
        </div>
      </form>
    </div>
  );
}
