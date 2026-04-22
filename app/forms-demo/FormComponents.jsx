import { z } from "zod";
import { createForm } from "@opentf/mwaf-form";
import { zodResolver } from "./zodResolver.js";

/**
 * A custom form field component that works with 'register' props.
 */
export function FormField(props) {
  const { label, error, touched, name, ...rest } = props;
  
  // Create a reactive visibility check
  const getError = () => touched?.value && error?.value?.[name];

  return (
    <div className="flex flex-col gap-1 mb-4">
      <label className="text-sm font-semibold text-slate-300">{label}</label>
      <input 
        name={name}
        {...rest} 
        className={`px-3 py-2 rounded-lg border transition-all outline-none bg-slate-900 text-white ${
          getError() ? 'border-red-500/50 bg-red-500/5' : 'border-slate-700 focus:border-blue-500'
        }`}
      />
      {() => getError() && <span className="text-xs text-red-400 font-medium">{getError()}</span>}
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
    <div className="flex items-center gap-3 mb-4 cursor-pointer" onclick={toggle}>
      <div className={`w-10 h-5 rounded-full transition-all duration-300 relative ${props.value ? 'bg-blue-600' : 'bg-slate-700'}`}>
        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm ${props.value ? 'left-6' : 'left-1'}`} />
      </div>
      <span className="text-sm text-slate-300 select-none">{props.label}</span>
    </div>
  );
}

/**
 * Basic Form Example with Zod
 */
export function BasicForm() {
  const schema = z.object({
    username: z.string().min(3, "Username must be at least 3 chars"),
    email: z.string().email("Invalid email address")
  });

  const form = createForm({
    initialValues: { username: "", email: "" },
    validator: zodResolver(schema)
  });

  return (
    <section className="bg-slate-800/40 backdrop-blur-xl p-8 rounded-2xl border border-slate-700/50 shadow-2xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
        </div>
        <h2 className="text-xl font-bold text-white tracking-tight">Basic Account</h2>
      </div>

      <form onsubmit={form.handleSubmit((v) => alert('Submitted: ' + JSON.stringify(v)))}>
        <FormField 
          label="Username" 
          {...form.register('username')} 
          error={form.errors} 
          touched={form.touched.username} 
        />
        <FormField 
          label="Email" 
          {...form.register('email')} 
          error={form.errors} 
          touched={form.touched.email} 
        />
        
        <button type="submit" className="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-lg shadow-blue-600/20">
          Save Changes
        </button>
      </form>

      <div className="mt-6 pt-6 border-t border-slate-700">
        <p className="text-[10px] font-mono text-blue-400/60 uppercase mb-2">Live State</p>
        <pre className="text-[10px] font-mono bg-slate-900/50 p-2 rounded text-blue-300/80 overflow-auto">
          {() => JSON.stringify(form.values, null, 2)}
        </pre>
      </div>
    </section>
  );
}

/**
 * Complex Form Example with Zod
 */
export function ComplexForm() {
  const schema = z.object({
    profile: z.object({
      firstName: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required")
    }),
    preferences: z.object({
      newsletter: z.boolean()
    }),
    skills: z.array(z.string().min(1, "Skill name cannot be empty")).min(1, "Add at least one skill")
  });

  const form = createForm({
    initialValues: {
      profile: { firstName: "", lastName: "" },
      preferences: { newsletter: true },
      skills: ["JavaScript"] 
    },
    validator: zodResolver(schema)
  });

  const addSkill = () => {
    form.values.skills = [...(form.values.skills || []), ""];
  };

  const removeSkill = (index) => {
    const current = [...(form.values.skills || [])];
    current.splice(index, 1);
    form.values.skills = current;
  };

  return (
    <section className="bg-slate-800/40 backdrop-blur-xl p-8 rounded-2xl border border-slate-700/50 shadow-2xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
        </div>
        <h2 className="text-xl font-bold text-white tracking-tight">Complex Profile</h2>
      </div>

      <form onsubmit={form.handleSubmit((v) => alert('Submitted: ' + JSON.stringify(v)))}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField 
            label="First Name" 
            {...form.register('profile.firstName')} 
            error={form.errors} 
            touched={form.touched["profile.firstName"]} 
          />
          <FormField 
            label="Last Name" 
            {...form.register('profile.lastName')} 
            error={form.errors} 
            touched={form.touched["profile.lastName"]} 
          />
        </div>

        <CustomToggle label="Subscribe to newsletter" {...form.register("preferences.newsletter")} />

        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-300">Skills</label>
            <button type="button" onclick={addSkill} className="text-xs text-purple-400 hover:text-purple-300 font-medium px-2 py-1 bg-purple-500/10 rounded-md">+ Add</button>
          </div>
          
          {form.values.skills.map((skill, index) => (
            <div className="flex gap-2 group">
              <div className="flex-1">
                <input 
                  {...form.register(`skills.${index}`)} 
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-white focus:border-purple-500 outline-none text-sm"
                  placeholder={`Skill #${index + 1}`}
                />
                {(() => {
                  const path = `skills.${index}`;
                  const getError = () => form.touched[path]?.value && form.errors.value[path];
                  return () => getError() && <span className="text-[10px] text-red-400 mt-1 block">{getError()}</span>;
                })()}
              </div>
              <button type="button" onclick={() => removeSkill(index)} className="text-slate-500 hover:text-red-400 px-2">×</button>
            </div>
          ))}
          {(() => {
            const getError = () => form.touched.skills?.value && form.errors.value.skills;
            return () => getError() && <p className="text-xs text-red-400">{getError()}</p>;
          })()}
        </div>

        <button type="submit" className="w-full py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold shadow-lg shadow-purple-600/20">
          Submit Profile
        </button>
      </form>

      <div className="mt-6 pt-6 border-t border-slate-700">
        <p className="text-[10px] font-mono text-purple-400/60 uppercase mb-2">Live State</p>
        <pre className="text-[10px] font-mono bg-slate-900/50 p-2 rounded text-purple-300/80 overflow-auto">
          {() => JSON.stringify(form.values, null, 2)}
        </pre>
      </div>
    </section>
  );
}
