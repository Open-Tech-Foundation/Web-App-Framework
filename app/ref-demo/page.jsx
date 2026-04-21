import FancyModal from "../components/FancyModal.jsx";

export default function RefDemoPage() {
  const modalRef = $ref();
  const inputRef = $ref();
  let message = $state("Hello WAF!");

  const focusInput = () => {
    inputRef.focus();
    inputRef.select();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-12 space-y-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-black bg-linear-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
          $ref & $expose Demo
        </h1>
        <p className="text-slate-400 max-w-2xl">
          This page demonstrates how to use the <code>$ref</code> macro to capture DOM elements and 
          custom component instances, and how <code>$expose</code> allows components to provide a clean imperative API.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Section 1: Native Element Ref */}
        <section className="bg-slate-900/50 p-8 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold">Native Element Reference</h2>
          <p className="text-sm text-slate-400">
            Control standard HTML elements directly. Click the button to focus and select the text in the input field.
          </p>
          <div className="flex gap-4">
            <input 
              ref={inputRef}
              value={message}
              oninput={(e) => message = e.target.value}
              className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
            <button 
              onclick={focusInput}
              className="bg-slate-800 hover:bg-slate-700 px-6 py-3 rounded-xl font-medium transition-colors"
            >
              Focus Me
            </button>
          </div>
        </section>

        {/* Section 2: Component Ref + Expose */}
        <section className="bg-slate-900/50 p-8 rounded-3xl border border-white/10 space-y-6">
          <h2 className="text-xl font-bold">Custom Component API</h2>
          <p className="text-sm text-slate-400">
            The <code>FancyModal</code> component exposes <code>open()</code> and <code>close()</code> methods via <code>$expose</code>. 
            We trigger them here using a reference to the component.
          </p>
          <button 
            onclick={() => modalRef.open()}
            className="w-full bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 py-4 rounded-2xl font-bold shadow-lg shadow-indigo-500/20 transition-all"
          >
            Open Fancy Modal
          </button>
        </section>
      </div>

      <FancyModal ref={modalRef} title="Ref Power!">
        <p>This modal was opened using a ref to the component instance!</p>
        <p className="mt-4">Current Input Value: <span className="text-indigo-400 font-mono">{message}</span></p>
      </FancyModal>
    </div>
  );
}
