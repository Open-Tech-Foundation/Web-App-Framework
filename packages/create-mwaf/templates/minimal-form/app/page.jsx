export default function HomePage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div className="space-y-4">
        <h2 className="text-4xl font-extrabold tracking-tight">
          Welcome to your <span className="text-indigo-500">MWAF</span> Journey
        </h2>
        <p className="text-xl text-slate-400 max-w-2xl">
          A high-performance, zero-VDOM framework built on standard Web Components and fine-grained reactivity.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FeatureCard 
          title="Zero VDOM" 
          desc="Compiles JSX directly to imperative DOM operations for maximum speed."
          icon="⚡"
        />
        <FeatureCard 
          title="Scoped Packages" 
          desc="Built on the professional @opentf ecosystem for trust and stability."
          icon="🛡️"
        />
      </div>

      <div className="p-6 bg-slate-800 rounded-2xl border border-slate-700">
        <h3 className="font-bold text-lg mb-2">Next Steps</h3>
        <ul className="list-disc list-inside text-slate-400 space-y-2">
          <li>Edit <code className="text-emerald-400">app/page.jsx</code> to change this page.</li>
          <li>Add new routes by creating folders in <code className="text-emerald-400">app/</code>.</li>
          <li>Check out the official documentation for advanced features.</li>
        </ul>
      </div>
    </div>
  );
}

function FeatureCard({ title, desc, icon }) {
  return (
    <div className="p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50 hover:border-indigo-500/50 transition-all group">
      <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">{icon}</div>
      <h3 className="font-bold text-lg mb-1">{title}</h3>
      <p className="text-slate-400">{desc}</p>
    </div>
  );
}
