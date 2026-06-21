import { Link } from "@opentf/web";
import ThemeToggle from "./components/ThemeToggle.jsx";

export default function WebsiteLayout(props) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
      <header className="sticky top-0 z-50 bg-[var(--bg-main)]/80 backdrop-blur-md border-b border-[var(--border)] px-8 py-4 flex justify-between items-center transition-colors">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Logo" className="w-8 h-8" />
          <span className="font-bold tracking-tight text-lg text-[var(--text-main)]">OTF Web</span>
          <span className="px-2 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] rounded text-[10px] uppercase tracking-wider font-bold">v0.4.0</span>
        </div>

        <nav className="flex items-center gap-8 text-sm font-medium text-[var(--text-muted)]">
          <Link href="/" className="hover:text-[var(--text-main)] transition-colors">Home</Link>
          <Link href="/docs" className="hover:text-[var(--text-main)] transition-colors">Docs</Link>
          <a href="https://github.com/Open-Tech-Foundation/Web-App-Framework" target="_blank" className="hover:text-[var(--text-main)] transition-colors">GitHub</a>
          <ThemeToggle />
        </nav>
      </header>

      <main className="flex-1 flex flex-col">
        {props.children}
      </main>

      <footer className="py-12 border-t border-[var(--border)] flex flex-col md:flex-row justify-between items-center px-8 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] mt-auto transition-colors">
        <div className="flex flex-col gap-2">
          <div className="font-bold text-[var(--text-main)] flex items-center gap-2">
            OTF Web
          </div>
          <div>© 2026 <a href="https://github.com/Open-Tech-Foundation" target="_blank" className="hover:text-[var(--text-main)] transition-colors">Open Tech Foundation</a>.</div>
        </div>

        <div className="flex flex-col items-center md:items-end gap-4 mt-6 md:mt-0">
          <div className="flex items-center gap-3 px-5 py-2.5 bg-[var(--bg-main)] border border-[var(--border)] rounded-full text-[var(--text-muted)] shadow-sm transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>Built with <a className="font-semibold text-[var(--text-main)]" href="https://github.com/Open-Tech-Foundation/Web-App-Framework" target="_blank">OTF Web</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
