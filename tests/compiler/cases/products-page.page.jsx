export default function ProductsPage() {
  let products = $state(Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `Product ${i}`,
    price: Math.floor(Math.random() * 1000)
  })));

  const shuffle = () => {
    const arr = [...products];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    products = arr;
  };

  const reverse = () => {
    products = [...products].reverse();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Products (1000 items)</h1>
        <div className="space-x-4">
          <button onclick={shuffle} className="bg-indigo-600 px-4 py-2 rounded text-white hover:bg-indigo-500 transition-colors">
            Shuffle List
          </button>
          <button onclick={reverse} className="bg-slate-700 px-4 py-2 rounded text-white hover:bg-slate-600 transition-colors">
            Reverse List
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {products.map(p => (
          <div key={p.id} className="p-4 bg-slate-800 rounded border border-slate-700 hover:border-indigo-500 transition-all">
            <div className="font-bold text-white">{p.name}</div>
            <div className="text-slate-400 mt-1">${p.price}</div>
            <input 
              placeholder="Add note..." 
              className="mt-2 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
