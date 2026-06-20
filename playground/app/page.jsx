// Home page — a self-contained reactive "target selector" that exercises the
// compiler's core patterns: $state, $derived, list rendering, conditional holes,
// and event handlers. Kept as a single component (no cross-component callback
// props or JSX-valued lookup tables) so it compiles cleanly on the new pipeline.

export const targets = [
  { id: 'js', label: 'JavaScript', color: '#f7df1e' },
  { id: 'python', label: 'Python', color: '#3776ab' },
  { id: 'go', label: 'Go', color: '#00add8' },
  { id: 'java', label: 'Java', color: '#ed8b00' },
  { id: 'ruby', label: 'Ruby', color: '#cc342d' },
  { id: 'csharp', label: 'C#', color: '#239120' },
  { id: 'php', label: 'PHP', color: '#777bb3' },
  { id: 'cplusplus', label: 'C++', color: '#00599c' },
];

export default function Home() {
  let selectedTarget = $state('js');
  let isOpen = $state(false);

  const selectedInfo = $derived(
    targets.find((t) => t.id === selectedTarget) || targets[0],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-12 flex flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight mb-2 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
          Compiler Target Selector
        </h1>
        <p className="text-zinc-400 text-sm">
          Testing JSX transformation and reactivity patterns
        </p>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-2xl shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col gap-4 items-center">
          <div className="relative">
            <button
              onclick={() => (isOpen = !isOpen)}
              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-all text-xs font-bold uppercase tracking-wider text-zinc-100 cursor-pointer"
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={`background-color: ${selectedInfo.color}`}
              ></span>
              <span>{selectedInfo.label}</span>
            </button>

            {isOpen && (
              <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-lg overflow-hidden z-50 min-w-[180px]">
                {targets.map((target) => (
                  <button
                    onclick={() => {
                      selectedTarget = target.id;
                      isOpen = false;
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800 transition-all text-left cursor-pointer"
                  >
                    <span
                      className="w-4 h-4 rounded-full shrink-0"
                      style={`background-color: ${target.color}`}
                    ></span>
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-100">
                      {target.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3 px-4 py-2 bg-zinc-800/50 rounded-full border border-zinc-700/50">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
              Active:
            </span>
            <span className="text-sm font-mono text-blue-400">{selectedTarget}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
