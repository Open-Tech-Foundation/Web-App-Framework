import { Link, router } from "@opentf/web";

export default function GlobalLayout(props) {
  return (
    <div className="min-h-screen bg-slate-900 p-8 text-slate-100">
      {/* Global Loading Bar */}
      {router.isGuarding && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-indigo-500 shadow-lg shadow-indigo-500/50 animate-pulse z-[2000]" />
      )}
      <nav className="mb-8 flex flex-wrap gap-4 bg-slate-800 p-4 rounded shadow border border-slate-700">
        <Link href="/" className="hover:text-white transition-colors">Home</Link>
        <Link href="/login" className="hover:text-red-400 transition-colors">Login</Link>
        <Link href="/counter" className="hover:text-white transition-colors">Counter</Link>
        <Link href="/about" className="hover:text-white transition-colors">About</Link>
        <Link href="/products" className="hover:text-white transition-colors">Products</Link>
        <Link href="/shop/clothing/shirts" className="hover:text-white transition-colors">Shop</Link>
        <Link href="/post/1" className="hover:text-white transition-colors">Post 1</Link>
        <Link href="/post/2" className="hover:text-white transition-colors">Post 2</Link>
        <Link href="/router-test" className="hover:text-white transition-colors">Router API</Link>
        <Link href="/ref-demo" className="text-indigo-400 font-bold hover:text-indigo-300 transition-colors">Ref & Expose</Link>
        <Link href="/forms-demo" className="text-emerald-400 font-bold hover:text-emerald-300 transition-colors">Forms Demo</Link>
        <Link href="/icons" className="text-amber-400 font-bold hover:text-amber-300 transition-colors">SVG Icons</Link>
        <Link href="/reconnect-demo" className="text-pink-400 font-bold hover:text-pink-300 transition-colors">Memory Leak Demo</Link>
      </nav>
      <main className="bg-slate-800 p-8 rounded shadow border border-slate-700">
        {props.children}
      </main>
    </div>
  );
}
