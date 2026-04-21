export default function CodeBlock(props) {
  const codeRef = $ref();
  let showCompiled = $state(false);

  $effect(() => {
    const content = showCompiled ? props.compiled : props.code;
    const el = codeRef;
    if (el && content) {
      el.textContent = content;
      const highlight = () => {
        if (window.Prism) {
          window.Prism.highlightElement(el);
        } else {
          setTimeout(highlight, 50);
        }
      };
      setTimeout(highlight, 0);
    }
  });

  return (
    <div className="relative group border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
      {props.compiled ? (
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-white/5 backdrop-blur-sm">
          <div className="flex gap-2">
            <button 
              onclick={() => showCompiled = false}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${!showCompiled ? 'bg-accent text-white' : 'text-white'}`}
            >
              Source
            </button>
            <button 
              onclick={() => showCompiled = true}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${showCompiled ? 'bg-accent text-white' : 'text-white'}`}
            >
              Compiled
            </button>
          </div>
          <div className="text-[10px] font-bold text-white uppercase tracking-widest opacity-80">
            {showCompiled ? 'javascript' : (props.language || 'jsx')}
          </div>
        </div>
      ) : (
        <div className="absolute top-3 right-4 text-[10px] font-bold text-white/40 uppercase tracking-widest pointer-events-none z-10">
          {props.language || 'jsx'}
        </div>
      )}

      <pre className="!bg-[#272822] !m-0 !p-6 text-sm overflow-x-auto custom-scrollbar min-h-[100px]">
        <code 
          ref={codeRef} 
          className={`!text-white !opacity-100 language-${showCompiled ? 'javascript' : (props.language || 'jsx')}`}
        ></code>
      </pre>
    </div>
  );
}
