export default function Counter() {
  let count = $state(0);

  return (
    <div className="flex gap-4 items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
      <button onclick={() => count--} className="w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-all active:scale-95">-</button>
      <span className="text-3xl font-bold w-12 text-center text-accent">{count}</span>
      <button onclick={() => count++} className="w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-all active:scale-95">+</button>
    </div>
  );
}
