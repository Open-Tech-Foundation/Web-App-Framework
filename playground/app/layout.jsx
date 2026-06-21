import { Link, router } from "@opentf/web";

export default function GlobalLayout(props) {
  return (
    <div className="min-h-screen bg-slate-900 p-8 text-slate-100">
      {/* Global Loading Bar */}
      {router.isGuarding && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-indigo-500 shadow-lg shadow-indigo-500/50 animate-pulse z-[2000]" />
      )}
      <nav className="mb-8 flex items-center gap-4 bg-slate-800 p-4 rounded shadow border border-slate-700">
        <Link href="/" className="font-bold text-white hover:text-indigo-300 transition-colors">OTF Web</Link>
        <span className="text-slate-600">/</span>
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition-colors">All demos</Link>
      </nav>
      <main className="bg-slate-800 p-8 rounded shadow border border-slate-700">
        {props.children}
      </main>
    </div>
  );
}
