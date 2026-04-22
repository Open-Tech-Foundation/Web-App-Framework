import { router } from "@opentf/mwaf-core";

export default function RouterTestPage() {
  const pushTest = () => {
    router.push('/router-test?query=hello');
  };

  const replaceTest = () => {
    router.replace('/router-test?query=replaced');
  };

  const goBack = () => {
    window.history.back();
  };

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold text-white">Router API Test</h1>
      
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-4">
        <div>
          <div className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">Current Pathname</div>
          <div className="text-emerald-400 font-mono text-xl">{() => router.pathname}</div>
        </div>
        
        <div>
          <div className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">Search Params (query)</div>
          <div className="text-indigo-400 font-mono text-xl">
            {() => router.searchParams.get('query') || 'none'}
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <button 
          onclick={pushTest}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          Push ?query=hello
        </button>
        
        <button 
          onclick={replaceTest}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          Replace ?query=replaced
        </button>
        
        <button 
          onclick={goBack}
          className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
