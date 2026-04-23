import { Link } from "@opentf/web";

export default function WebsiteLayout(props) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Logo" className="w-8 h-8" />
          <span className="font-bold tracking-tight text-lg">Web App Framework</span>
          <span className="px-2 py-0.5 bg-[#ff851b]/10 text-[#ff851b] rounded text-[10px] uppercase tracking-wider font-bold">v0.3.0</span>
        </div>

        <nav className="flex gap-8 text-sm font-medium text-slate-500">
          <Link href="/" className="hover:text-black transition-colors">Home</Link>
          <Link href="/docs" className="hover:text-black transition-colors">Docs</Link>
          <a href="https://github.com/Open-Tech-Foundation/Web-App-Framework" target="_blank" className="hover:text-black transition-colors">GitHub</a>
        </nav>
      </header>

      <main className="flex-1 flex flex-col">
        {props.children}
      </main>

      <footer className="py-12 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center px-8 text-xs text-slate-400 bg-slate-50 mt-auto">
        <div className="flex flex-col gap-2">
          <div className="font-bold text-slate-900 flex items-center gap-2">
            Web App Framework
          </div>
          <div>© 2026 <a href="https://github.com/Open-Tech-Foundation" target="_blank" className="hover:text-slate-900 transition-colors">Open Tech Foundation</a>.</div>
        </div>

        <div className="flex flex-col items-center md:items-end gap-4 mt-6 md:mt-0">
          <div className="flex items-center gap-3 px-5 py-2.5 bg-white border border-slate-200 rounded-full text-slate-600 shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>This site is built entirely using <strong>Web App Framework</strong></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
