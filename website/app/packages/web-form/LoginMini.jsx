import { createForm } from "@opentf/web-form";

// Mini demo for the `createForm` section: the exact login form from the code
// sample above, running live. Self-styled with the docs theme variables so it
// follows light/dark mode.

const frame = "not-prose mt-4 mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const label = "block text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1";
const field = "w-full px-3 py-2 rounded-lg border bg-[var(--bg-main)] text-[var(--text-main)] text-sm outline-none border-[var(--border)] focus:border-indigo-500/60 transition-all";
const btn = "px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 disabled:shadow-none";

export default function LoginMini() {
  let result = $state("");

  const form = createForm({
    initialValues: { email: "", password: "" },
  });

  const onSubmit = async (values) => {
    result = "";
    await new Promise((r) => setTimeout(r, 600));
    result = `Signed in as ${values.email}`;
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
        <div>
          <label class={label}>Password</label>
          <input {...form.register("password")} type="password" placeholder="••••••••" class={field} />
        </div>
        <div class="flex items-center gap-3 pt-1">
          <button type="submit" disabled={form.isSubmitting} class={btn}>
            {form.isSubmitting ? "Signing in…" : "Sign in"}
          </button>
          {result && <span class="text-sm font-bold text-emerald-600">{result}</span>}
        </div>
      </form>
    </div>
  );
}
