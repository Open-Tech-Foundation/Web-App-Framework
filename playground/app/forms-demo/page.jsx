import { z } from "zod";
import { createForm } from "@opentf/web-form";
import { zodResolver } from "./zodResolver.js";

// Everything lives in this one module: the page (default export) plus the two
// form components used as tags. Same-module components compile to local custom
// elements, so no cross-module export wiring is needed. (A component meant to be
// imported by *another* file must be that file's default export — the compiler
// names component classes `<Name>Element` and only a default import re-binds the
// tag cleanly.)

const inputBase =
  "w-full px-4 py-3 rounded-xl border bg-slate-900/50 text-white placeholder-slate-500 outline-none transition-all";
const inputOk = inputBase + " border-slate-700/50 focus:border-blue-500/60";
const inputErr = inputBase + " border-red-500/60 bg-red-500/5";
const badge = "flex items-center justify-center p-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all";
const badgeOn = badge + " bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
const badgeOff = badge + " bg-slate-800/20 border-slate-700/30 text-slate-500";

function BasicForm() {
  const schema = z.object({
    username: z.string().min(3, "Username must be at least 3 chars"),
    email: z.string().email("Invalid email address"),
  });

  const form = createForm({
    initialValues: { username: "", email: "" },
    validator: zodResolver(schema),
    mode: "onChange",
  });

  const onSubmit = async (values) => {
    await new Promise((r) => setTimeout(r, 1200));
    console.log("Submitted:", values);
  };

  return (
    <div class="grid lg:grid-cols-[1fr_320px] gap-10 items-start">
      <section class="bg-slate-800/20 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/50 shadow-2xl">
        <div class="mb-6">
          <h2 class="text-2xl font-black text-white tracking-tight">Basic account</h2>
          <p class="text-slate-500 text-xs font-medium">Live Zod validation · onChange mode</p>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-8">
          <div class={form.isValid ? badgeOn : badgeOff}>{form.isValid ? "Valid" : "Invalid"}</div>
          <div class={form.isChanged ? badgeOn : badgeOff}>{form.isChanged ? "Changed" : "Clean"}</div>
          <div class={form.isSubmitting ? badgeOn : badgeOff}>{form.isSubmitting ? "Saving" : "Idle"}</div>
        </div>

        <form onsubmit={form.handleSubmit(onSubmit)}>
          <div class="mb-5">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Username</label>
            <input {...form.register("username")} placeholder="ada" class={form.errors.username ? inputErr : inputOk} />
            {form.errors.username && <span class="text-[10px] text-red-400 font-bold ml-1">{form.errors.username}</span>}
          </div>

          <div class="mb-5">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Email</label>
            <input {...form.register("email")} placeholder="ada@example.com" class={form.errors.email ? inputErr : inputOk} />
            {form.errors.email && <span class="text-[10px] text-red-400 font-bold ml-1">{form.errors.email}</span>}
          </div>

          <div class="flex gap-4 mt-8">
            <button type="button" onclick={() => form.reset()} class="flex-1 py-3.5 border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700/30 hover:text-white transition-all font-bold uppercase text-[11px]">Reset</button>
            <button type="submit" disabled={!form.isValid || form.isSubmitting} class="flex-[2] py-3.5 text-white rounded-xl font-bold uppercase text-[11px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              {form.isSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>

          {form.isSubmitted && <div class="mt-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center text-xs font-bold text-emerald-400">✨ Saved successfully!</div>}
        </form>
      </section>

      <div class="lg:sticky lg:top-8">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 ml-1">Live values</p>
        <pre class="text-[11px] font-mono bg-slate-950/80 p-5 rounded-2xl border border-slate-800/50 text-blue-300/80 overflow-auto max-h-[300px]">{JSON.stringify(form.values, null, 2)}</pre>
      </div>
    </div>
  );
}

function ComplexForm() {
  const schema = z.object({
    profile: z.object({
      firstName: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required"),
    }),
    skills: z.array(z.string().min(1, "Skill required")).min(1, "Add at least one skill"),
    preferences: z.object({ newsletter: z.boolean() }),
  });

  const form = createForm({
    initialValues: {
      profile: { firstName: "", lastName: "" },
      skills: ["JavaScript"],
      preferences: { newsletter: true },
    },
    validator: zodResolver(schema),
    mode: "onChange",
  });

  const addSkill = () => form.values.skills.push("");
  const removeSkill = (i) => form.values.skills.splice(i, 1);

  const onSubmit = async (values) => {
    await new Promise((r) => setTimeout(r, 1200));
    console.log("Submitted profile:", values);
  };

  return (
    <div class="grid lg:grid-cols-[1fr_320px] gap-10 items-start">
      <section class="bg-slate-800/20 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/50 shadow-2xl">
        <div class="mb-6">
          <h2 class="text-2xl font-black text-white tracking-tight">Advanced profile</h2>
          <p class="text-slate-500 text-xs font-medium">Nested paths · dynamic array · checkbox</p>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-8">
          <div class={form.isValid ? badgeOn : badgeOff}>{form.isValid ? "Valid" : "Invalid"}</div>
          <div class={form.isChanged ? badgeOn : badgeOff}>{form.isChanged ? "Changed" : "Clean"}</div>
          <div class={form.isSubmitting ? badgeOn : badgeOff}>{form.isSubmitting ? "Saving" : "Idle"}</div>
        </div>

        <form onsubmit={form.handleSubmit(onSubmit)}>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">First name</label>
              <input {...form.register("profile.firstName")} class={form.errors.profile?.firstName ? inputErr : inputOk} />
            </div>
            <div>
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Last name</label>
              <input {...form.register("profile.lastName")} class={form.errors.profile?.lastName ? inputErr : inputOk} />
            </div>
          </div>

          <div class="mb-6">
            <div class="flex items-center justify-between mb-3">
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Skills</label>
              <button type="button" onclick={addSkill} class="text-[11px] font-bold text-purple-400 hover:text-purple-300">+ Add skill</button>
            </div>
            <div class="space-y-3">
              {form.values.skills.map((_, index) => (
                <div class="flex gap-2">
                  <input {...form.register(`skills.${index}`)} placeholder="Skill name…" class={form.errors.skills?.[index] ? inputErr : inputOk} />
                  <button type="button" onclick={() => removeSkill(index)} class="px-4 rounded-xl border border-slate-700/50 text-slate-500 hover:text-red-400 hover:bg-red-400/5 transition-all">✕</button>
                </div>
              ))}
            </div>
          </div>

          <label class="flex items-center justify-between p-4 rounded-xl border border-slate-700/30 bg-slate-900/20 mb-6 cursor-pointer">
            <span class="text-sm font-medium text-slate-300">Subscribe to developer updates</span>
            <input type="checkbox" {...form.register("preferences.newsletter")} />
          </label>

          <div class="flex gap-4 mt-8">
            <button type="button" onclick={() => form.reset()} class="flex-1 py-3.5 border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700/30 hover:text-white transition-all font-bold uppercase text-[11px]">Reset</button>
            <button type="submit" disabled={!form.isValid || form.isSubmitting} class="flex-[2] py-3.5 text-white rounded-xl font-bold uppercase text-[11px] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              {form.isSubmitting ? "Saving…" : "Submit profile"}
            </button>
          </div>

          {form.isSubmitted && <div class="mt-6 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center text-xs font-bold text-purple-400">✨ Profile updated!</div>}
        </form>
      </section>

      <div class="lg:sticky lg:top-8">
        <p class="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 ml-1">Live values</p>
        <pre class="text-[11px] font-mono bg-slate-950/80 p-5 rounded-2xl border border-slate-800/50 text-blue-300/80 overflow-auto max-h-[300px]">{JSON.stringify(form.values, null, 2)}</pre>
      </div>
    </div>
  );
}

export default function FormsDemo() {
  let activeTab = $state("basic");

  return (
    <div class="max-w-7xl mx-auto space-y-8 pb-24 px-4 sm:px-6">
      <header class="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-800 pb-10">
        <div>
          <h1 class="text-4xl font-black text-white tracking-tight">Forms Playground</h1>
          <p class="text-slate-400 mt-2 font-medium">
            Real-time reactivity and validation with <code class="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-md font-mono text-sm border border-blue-500/20">@opentf/web-form</code>
          </p>
        </div>

        <nav class="flex p-1.5 bg-slate-900/60 rounded-2xl border border-slate-800/50">
          <button
            onclick={() => (activeTab = "basic")}
            class={activeTab === "basic"
              ? "px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold transition-all"
              : "px-6 py-2.5 rounded-xl text-slate-400 text-sm font-bold hover:text-slate-200 transition-all"}
          >
            Basic Form
          </button>
          <button
            onclick={() => (activeTab = "complex")}
            class={activeTab === "complex"
              ? "px-6 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-bold transition-all"
              : "px-6 py-2.5 rounded-xl text-slate-400 text-sm font-bold hover:text-slate-200 transition-all"}
          >
            Complex Form
          </button>
        </nav>
      </header>

      <main class="py-4">{activeTab === "basic" ? <BasicForm /> : <ComplexForm />}</main>
    </div>
  );
}
