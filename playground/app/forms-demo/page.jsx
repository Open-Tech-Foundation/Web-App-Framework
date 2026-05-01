import { BasicForm, ComplexForm } from "./FormComponents";

/**
 * Web App Framework Forms Demo Page
 * 
 * This page acts as a container for our modular form components.
 * Each form component manages its own state using 'web-forms'.
 */
export default function FormsDemo() {
  const activeTab = $state("basic");

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-24 px-4 sm:px-6">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-800 pb-10">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tight">Forms Playground</h1>
          <p className="text-slate-400 mt-2 font-medium">
            Experience real-time reactivity and validation with <code className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-md font-mono text-sm border border-blue-500/20">@opentf/web-form</code>
          </p>
        </div>

        <nav className="flex p-1.5 bg-slate-900/60 rounded-2xl border border-slate-800/50 backdrop-blur-xl">
          <button 
            onclick={() => activeTab = "basic"}
            className={activeTab === "basic" 
              ? "px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-600/20 transition-all duration-300"
              : "px-6 py-2.5 rounded-xl text-slate-400 text-sm font-bold hover:text-slate-200 transition-all duration-300"
            }
          >
            Basic Form
          </button>
          <button 
            onclick={() => activeTab = "complex"}
            className={activeTab === "complex" 
              ? "px-6 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-bold shadow-lg shadow-purple-600/20 transition-all duration-300"
              : "px-6 py-2.5 rounded-xl text-slate-400 text-sm font-bold hover:text-slate-200 transition-all duration-300"
            }
          >
            Complex Form
          </button>
        </nav>
      </header>

      <main className="py-4">
        {activeTab === "basic" ? <BasicForm /> : <ComplexForm />}
      </main>

      <footer className="pt-12 border-t border-slate-800/50">
        <div className="bg-slate-900/30 p-8 rounded-3xl border border-slate-800/50 flex flex-col md:flex-row items-center gap-8">
          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0116 0z"></path></svg>
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-lg font-bold text-white mb-2">Zero-VDOM Architecture</h3>
            <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
              Unlike traditional frameworks, these forms are compiled into <strong>Native Web Components</strong>. 
              The state management uses fine-grained reactivity via <strong>Preact Signals</strong>, meaning only the 
              specific DOM nodes that change are updated. No virtual DOM diffing, no full re-renders.
            </p>
          </div>
          <a href="https://github.com/Open-Tech-Foundation/WAF" target="_blank" className="px-8 py-3 rounded-xl bg-slate-800 text-slate-200 font-bold text-sm hover:bg-slate-700 transition-all border border-slate-700/50 shadow-lg">
            View Docs
          </a>
        </div>
      </footer>
    </div>
  );
}
