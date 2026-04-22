import { BasicForm, ComplexForm } from "./FormComponents";

/**
 * MWAF Forms Demo Page
 * 
 * This page acts as a container for our modular form components.
 * Each form component manages its own state using 'mwaf-forms'.
 */
export default function FormsDemo() {
  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold text-white tracking-tight">MWAF Forms Demo</h1>
        <p className="text-slate-400 mt-2">
          Showcasing a modular approach to form management using <code className="text-blue-400 bg-blue-500/10 px-1 rounded">mwaf-forms</code>
          and native Web Components.
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <BasicForm />
        <ComplexForm />
      </div>

      <section className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Architecture Note</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          In MWAF, every capitalized component (like <code className="text-slate-300">BasicForm</code>) is compiled
          into a native Custom Element. This ensures that form state and validation logic are encapsulated within
          the component's own lifecycle, providing a clean separation of concerns between pages and features.
        </p>
      </section>
    </div>
  );
}
