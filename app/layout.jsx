import { Link, router } from "@opentf/mwaf-core";

export default function GlobalLayout(props) {
  return (
    <div className="min-h-screen bg-slate-900 p-8 text-slate-100">
      {/* Global Loading Bar */}
      {() => router.isGuarding && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-indigo-500 shadow-lg shadow-indigo-500/50 animate-pulse z-[2000]" />
      )}
      <nav className="mb-8 flex gap-4 bg-slate-800 p-4 rounded shadow border border-slate-700">
        <Link href="/">Home</Link>
        <Link href="/login" className="hover:text-red-400">Login</Link>
        <Link href="/counter">Counter</Link>
        <Link href="/about">About</Link>
        <Link href="/products">Products</Link>
        <Link href="/shop/clothing/shirts">Shop</Link>
        <Link href="/post/1">Post 1</Link>
        <Link href="/post/2">Post 2</Link>
        <Link href="/router-test">Router API</Link>
        <Link href="/ref-demo" className="text-indigo-400 font-bold">Ref & Expose</Link>
        <Link href="/forms-demo" className="text-emerald-400 font-bold">Forms Demo</Link>
      </nav>
      <main className="bg-slate-800 p-8 rounded shadow border border-slate-700">
        {props.children}
      </main>
    </div>
  );
}
