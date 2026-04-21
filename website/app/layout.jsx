import Link from "../../framework/router/Link.wc.jsx";

export default function WebsiteLayout(props) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Logo" className="w-8 h-8" />
          <span className="font-bold tracking-tight text-lg">WAF</span>
        </div>
        
        <nav className="flex gap-8 text-sm font-medium text-slate-500">
          <Link href="/" className="hover:text-black transition-colors">Home</Link>
          <Link href="/docs" className="hover:text-black transition-colors">Docs</Link>
          <a href="https://github.com/Open-Tech-Foundation" target="_blank" className="hover:text-black transition-colors">GitHub</a>
        </nav>
      </header>

      <main className="flex-1 flex flex-col">
        {props.children}
      </main>

      <footer className="py-12 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center px-8 text-xs text-slate-400 bg-slate-50 mt-auto">
        <div className="flex flex-col gap-2">
          <div className="font-bold text-slate-900 flex items-center gap-2">
            WAF Framework
            <span className="px-2 py-0.5 bg-accent/10 text-accent rounded text-[10px] uppercase tracking-wider">v0.1-alpha</span>
          </div>
          <div>© 2026 Open-Tech-Foundation. Experimental.</div>
        </div>

        <div className="flex flex-col items-center md:items-end gap-4 mt-6 md:mt-0">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-white border border-slate-200 rounded-full text-slate-600 shadow-sm">
            <span className="text-[#10b981] font-bold text-lg leading-none" style={{ marginTop: '-2px' }}>✓</span>
            <span>This site is rendered entirely using <strong>WAF</strong></span>
          </div>
          <div className="flex gap-6">
            <a href="https://twitter.com" className="hover:text-black">Twitter</a>
            <a href="https://github.com/Open-Tech-Foundation" className="hover:text-black">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
