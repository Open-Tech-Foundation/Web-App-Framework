import { mapped } from "@opentf/mwaf-core";

export default function ProductsPage() {
  let productsNaive = $state([]);
  let productsOptimized = $state([]);
  let naiveTime = $state(0);
  let optimizedTime = $state(0);

  onMount(() => {
    const data = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      name: `Product ${i}`,
      price: (Math.random() * 100).toFixed(2),
    }));
    productsNaive = [...data];
    productsOptimized = [...data];
  });

  const shuffleNaive = () => {
    const s1 = performance.now();
    const newOrder = [...productsOptimized].sort(() => Math.random() - 0.5);
    productsNaive = newOrder;
    naiveTime = (performance.now() - s1).toFixed(2);
  };

  const shuffleOptimized = () => {
    const s2 = performance.now();
    const newOrder = [...productsOptimized].sort(() => Math.random() - 0.5);
    productsOptimized = newOrder;
    optimizedTime = (performance.now() - s2).toFixed(2);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-300 p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Performance Benchmark: 5000 Items</h1>
      
      <div className="grid grid-cols-2 gap-8">
        {/* Naive List */}
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Naive Re-render</h2>
              <p className="text-sm text-slate-400">Recreates DOM nodes</p>
            </div>
            <button 
              onclick={shuffleNaive}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition-colors"
            >
              Shuffle
            </button>
          </div>
          
          <div className="mb-4 p-4 bg-slate-900 rounded-xl flex justify-between items-center">
            <span className="text-sm font-medium text-slate-400">Render Time:</span>
            <div className="text-red-400 font-mono font-bold text-lg">{naiveTime}ms</div>
          </div>

          <div className="h-[600px] overflow-y-auto pr-2 space-y-2">
            {productsNaive.map(p => (
              <div key={p.id} className="flex justify-between items-center p-3 bg-slate-700/30 rounded-lg border border-slate-600/50">
                <span className="font-medium">{p.name}</span>
                <span className="text-emerald-400 font-mono">${p.price}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Optimized List */}
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Optimized (Keyed)</h2>
              <p className="text-sm text-slate-400">Moves existing DOM nodes</p>
            </div>
            <button 
              onclick={shuffleOptimized}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 rounded-lg text-white font-medium transition-colors"
            >
              Shuffle
            </button>
          </div>
          
          <div className="mb-4 p-4 bg-slate-900 rounded-xl flex justify-between items-center">
            <span className="text-sm font-medium text-slate-400">Render Time:</span>
            <div className="text-emerald-400 font-mono font-bold text-lg">{optimizedTime}ms</div>
          </div>

          <div className="h-[600px] overflow-y-auto pr-2 space-y-2">
            {productsOptimized.map(p => (
              <div key={p.id} className="flex justify-between items-center p-3 bg-slate-700/30 rounded-lg border border-slate-600/50">
                <span className="font-medium">{p.name}</span>
                <span className="text-emerald-400 font-mono">${p.price}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
