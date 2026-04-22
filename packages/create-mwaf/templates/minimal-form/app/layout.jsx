import { Link } from "@opentf/mwaf-core";

export default function RootLayout({ children }) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans antialiased">
      <header className="p-6 border-b border-slate-800 flex justify-between items-center">
        <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent">
          MWAF App
        </h1>
        <nav className="flex gap-6">
          <Link href="/" className="hover:text-indigo-400 transition-colors">Home</Link>
          <Link href="/about" className="hover:text-indigo-400 transition-colors">About</Link>
        </nav>
      </header>
      <main className="p-8 max-w-4xl mx-auto">
        {children}
      </main>
    </div>
  );
}
