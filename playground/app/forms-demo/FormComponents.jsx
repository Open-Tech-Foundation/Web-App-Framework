import { z } from "zod";
import { createForm } from "@opentf/web-form";
import { untracked } from "@opentf/web";
import { zodResolver } from "./zodResolver.js";

/**
 * A custom form field component that works with 'register' props.
 */
export function FormField(props) {
  const { label, name, form, ...rest } = props;

  const error = $derived(form.errors[name] && form.touched[name] ? form.errors[name] : null);

  return (
    <div className="flex flex-col gap-1.5 mb-5 group">
      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1 group-focus-within:text-blue-400 transition-colors">
        {label}
      </label>
      <input
        name={name}
        {...rest}
        className={error
          ? 'px-4 py-3 rounded-xl border transition-all duration-300 outline-none bg-red-500/5 border-red-500/50 text-white placeholder-slate-500 backdrop-blur-sm shadow-[0_0_15px_-3px_rgba(239,68,68,0.2)]'
          : 'px-4 py-3 rounded-xl border transition-all duration-300 outline-none bg-slate-900/50 border-slate-700/50 text-white placeholder-slate-500 backdrop-blur-sm focus:border-blue-500/50 focus:bg-slate-900/80 focus:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]'
        }
      />
      <div className="h-4 ml-1">
        {() => error && (
          <span className="text-[10px] text-red-400 font-bold flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A custom toggle/checkbox component.
 */
export function CustomToggle(props) {
  const toggle = () => {
    props.oninput({ target: { checked: !props.value, type: 'checkbox' } });
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-slate-700/30 bg-slate-900/20 mb-6 cursor-pointer hover:bg-slate-900/40 transition-all group" onclick={toggle}>
      <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">{props.label}</span>
      <div className={props.value ? 'w-12 h-6 rounded-full transition-all duration-500 relative p-1 bg-emerald-500 shadow-[0_0_15px_-3px_rgba(16,185,129,0.5)]' : 'w-12 h-6 rounded-full transition-all duration-500 relative p-1 bg-slate-700'}>
        <div className={props.value ? 'w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-lg transform translate-x-6' : 'w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-lg transform translate-x-0'} />
      </div>
    </div>
  );
}

export function FormStatus({ form }) {
  const isValid = $derived(form.isValid);
  const isChanged = $derived(form.isChanged);
  const isTouched = $derived(form.isTouched);
  const isSubmitting = $derived(form.isSubmitting);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      <div className={isValid ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500'}>
        <span className="text-[10px] font-black uppercase tracking-widest">{isValid ? "Valid" : "Invalid"}</span>
      </div>
      <div className={isChanged ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_15px_-5px_rgba(59,130,246,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500'}>
        <span className="text-[10px] font-black uppercase tracking-widest">{isChanged ? "Changed" : "Clean"}</span>
      </div>
      <div className={isTouched ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_-5px_rgba(245,158,11,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500'}>
        <span className="text-[10px] font-black uppercase tracking-widest">{() => isTouched ? "Touched" : "Untouched"}</span>
      </div>
      <div className={isSubmitting ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_0_15px_-5px_rgba(168,85,247,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500'}>
        <span className="text-[10px] font-black uppercase tracking-widest">{() => isSubmitting ? "Saving" : "Idle"}</span>
      </div>
    </div>
  );
}

export function ModeSelector({ label, value, options, onchange }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[100px]">
      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative group">
        <select
          value={value}
          onchange={(e) => onchange(e.target.value)}
          className="appearance-none w-full bg-slate-900/80 border border-slate-700/50 text-slate-200 text-[11px] font-bold rounded-lg px-3 py-1.5 outline-none focus:border-blue-500/50 transition-all cursor-pointer pr-8"
        >
          {options.map(opt => <option value={opt}>{opt}</option>)}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-500 group-hover:text-blue-400 transition-colors">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
        </div>
      </div>
    </div>
  );
}

export function StatePreview({ form }) {
  return (
    <div className="flex flex-col gap-6 sticky top-8">
      <div>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Live Values</p>
        </div>
        <pre className="text-[11px] font-mono bg-slate-950/80 p-5 rounded-2xl border border-slate-800/50 text-blue-300/80 overflow-auto max-h-[300px] leading-relaxed shadow-inner backdrop-blur-md">
          {() => JSON.stringify(form.values, null, 2)}
        </pre>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Validation State</p>
        </div>
        <pre className="text-[11px] font-mono bg-slate-950/80 p-5 rounded-2xl border border-slate-800/50 text-amber-300/80 overflow-auto max-h-[300px] leading-relaxed shadow-inner backdrop-blur-md">
          {() => JSON.stringify({ errors: form.errors, touched: form.touched }, null, 2)}
        </pre>
      </div>

      <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/50">
        <p className="text-[10px] font-medium text-slate-500 leading-tight">
          Identity Check: <code className="text-emerald-400">{() => (form.values === form.values ? '✓ Stable' : '✗ Unstable')}</code>
        </p>
      </div>
    </div>
  );
}

export function BasicForm() {
  const mode = $state("onBlur");
  const reValidateMode = $state("onChange");
  const schema = z.object({
    username: z.string().min(3, "Username must be at least 3 chars"),
    email: z.string().email("Invalid email address")
  });

  const form = createForm({
    initialValues: { username: "", email: "" },
    validator: zodResolver(schema),
    mode,
    reValidateMode
  });

  const isValid = $derived(form.isValid);
  const isChanged = $derived(form.isChanged);
  const isSubmitting = $derived(form.isSubmitting);
  const isSubmitted = $derived(form.isSubmitted);
  const canSubmit = $derived(isValid && !isSubmitting);

  return (
    <div className="grid lg:grid-cols-[1fr_350px] gap-12 items-start">
      <section className="bg-slate-800/20 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/50 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/20 text-blue-400 shadow-lg shadow-blue-500/10">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Basic Account</h2>
              <p className="text-slate-500 text-xs font-medium tracking-wide">Enter your core credentials</p>
            </div>
          </div>

          <div className="flex gap-3 bg-slate-950/40 p-2 rounded-2xl border border-slate-800/50">
            <ModeSelector label="Mode" value={mode} options={["onBlur", "onChange", "onTouched", "onSubmit"]} onchange={(v) => mode = v} />
            <ModeSelector label="Re-Validate" value={reValidateMode} options={["onChange", "onBlur", "onSubmit"]} onchange={(v) => reValidateMode = v} />
          </div>
        </div>

        <FormStatus form={form} />

        <form onsubmit={form.handleSubmit(async (v) => {
          await new Promise(r => setTimeout(r, 1500));
          console.log('Submitted:', v);
        })}>
          <FormField label="Username" name="username" form={form} {...form.register('username')} />
          <FormField label="Email" name="email" form={form} {...form.register('email')} />

          <div className="flex gap-4 mt-8">
            <button type="button" onclick={() => form.reset()} className="flex-1 py-3.5 border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700/30 hover:text-white transition-all font-bold tracking-wide uppercase text-[11px]">Reset</button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={canSubmit
                ? 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-blue-600 hover:bg-blue-500 shadow-blue-600/20 scale-100 hover:scale-[1.02] active:scale-[0.98]'
                : 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-slate-700 text-slate-500 opacity-50 cursor-not-allowed grayscale'
              }
            >
              {isSubmitting ? "Processing..." : "Save Changes"}
            </button>
          </div>

          {isSubmitted && (
            <div className="mt-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center text-xs font-bold text-emerald-400 animate-in fade-in zoom-in duration-300">
              ✨ Changes saved successfully!
            </div>
          )}
        </form>
      </section>

      <StatePreview form={form} />
    </div>
  );
}

export function ComplexForm() {
  const mode = $state("onBlur");
  const reValidateMode = $state("onChange");
  const schema = z.object({
    profile: z.object({
      firstName: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required")
    }),
    skills: z.array(z.string().min(1, "Skill name required")).min(1, "At least one skill required"),
    preferences: z.object({
      newsletter: z.boolean()
    })
  });

  const form = createForm({
    initialValues: {
      profile: { firstName: "", lastName: "" },
      skills: ["JavaScript"],
      preferences: { newsletter: true }
    },
    validator: zodResolver(schema),
    mode,
    reValidateMode
  });

  const isValid = $derived(form.isValid);
  const isChanged = $derived(form.isChanged);
  const isSubmitting = $derived(form.isSubmitting);
  const isSubmitted = $derived(form.isSubmitted);
  const canSubmit = $derived(isValid && !isSubmitting);

  const addSkill = () => form.values.skills.push("");
  const removeSkill = (index) => form.values.skills.splice(index, 1);

  return (
    <div className="grid lg:grid-cols-[1fr_350px] gap-12 items-start">
      <section className="bg-slate-800/20 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/50 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20 text-purple-400 shadow-lg shadow-purple-500/10">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Advanced Profile</h2>
              <p className="text-slate-500 text-xs font-medium tracking-wide">Nested data & preferences</p>
            </div>
          </div>

          <div className="flex gap-3 bg-slate-950/40 p-2 rounded-2xl border border-slate-800/50">
            <ModeSelector label="Mode" value={mode} options={["onBlur", "onChange", "onTouched", "onSubmit"]} onchange={(v) => mode = v} />
            <ModeSelector label="Re-Validate" value={reValidateMode} options={["onChange", "onBlur", "onSubmit"]} onchange={(v) => reValidateMode = v} />
          </div>
        </div>

        <FormStatus form={form} />

        <form onsubmit={form.handleSubmit(async (v) => {
          await new Promise(r => setTimeout(r, 1500));
          console.log('Submitted Profile:', v);
        })}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="First Name" name="profile.firstName" form={form} {...form.register('profile.firstName')} />
            <FormField label="Last Name" name="profile.lastName" form={form} {...form.register('profile.lastName')} />
          </div>

          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Skills & Expertise</label>
              <button type="button" onclick={addSkill} className="text-[10px] font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                Add Skill
              </button>
            </div>

            <div className="space-y-3">
              {() => form.values.skills.map((_, index) => (
                <div className="flex gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
                  <div className="flex-1">
                    <input
                      {...form.register(`skills.${index}`)}
                      placeholder="Skill name..."
                      className={form.errors.skills?.[index]
                        ? "w-full px-4 py-2.5 rounded-xl border bg-red-500/5 border-red-500/50 text-white text-sm outline-none"
                        : "w-full px-4 py-2.5 rounded-xl border bg-slate-900/50 border-slate-700/50 text-white text-sm outline-none focus:border-purple-500/50 transition-all"}
                    />
                  </div>
                  <button
                    type="button"
                    onclick={() => removeSkill(index)}
                    className="p-2.5 rounded-xl border border-slate-700/50 text-slate-500 hover:text-red-400 hover:bg-red-400/5 transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                </div>
              ))}
            </div>
            {() => form.errors.skills && typeof form.errors.skills === 'string' && (
              <p className="text-[10px] text-red-400 font-bold mt-2 ml-1">{form.errors.skills}</p>
            )}
          </div>

          <CustomToggle label="Subscribe to developer updates" {...form.register("preferences.newsletter")} />

          <div className="flex gap-4 mt-8">
            <button type="button" onclick={() => form.reset()} className="flex-1 py-3.5 border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700/30 hover:text-white transition-all font-bold tracking-wide uppercase text-[11px]">Reset</button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={canSubmit
                ? 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-purple-600 hover:bg-purple-700 shadow-purple-600/20 scale-100 hover:scale-[1.02] active:scale-[0.98]'
                : 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-slate-700 text-slate-500 opacity-50 cursor-not-allowed grayscale'
              }
            >
              {isSubmitting ? "Processing..." : "Submit Profile"}
            </button>
          </div>

          {isSubmitted && (
            <div className="mt-6 p-3 rounded-xl bg-purple-500/10 border border-emerald-500/20 text-center text-xs font-bold text-purple-400 animate-in fade-in zoom-in duration-300">
              ✨ Profile updated successfully!
            </div>
          )}
        </form>
      </section>

      <StatePreview form={form} />
    </div>
  );
}
