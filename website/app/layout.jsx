import { Navbar } from "@opentf/web-docs";
import config from "../otfw.config.js";

// Site-wide SEO defaults, inherited by every route (least-specific in the metadata
// merge). `titleTemplate` brands every child page's `<title>` (e.g. "Installation —
// OTF Web"); a page can opt out with `title: { absolute: "…" }`. The description and
// `og:site_name` act as fallbacks when a page doesn't set its own.
export const metadata = {
  titleTemplate: "%s — OTF Web",
  description:
    "A high-performance, zero-VDOM framework that compiles JSX to native DOM. Built with signals and standard Web Components.",
  openGraph: {
    siteName: "OTF Web",
    type: "website",
  },
};

// The site is itself a product of @opentf/web-docs (Nextra-style): the navbar — brand,
// version badge, active-route underline, GitHub icon, theme toggle — comes from the
// theme package, driven by otfw.config.js. The docs section reuses it via frame={false}.
export default function WebsiteLayout(props) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
      <Navbar config={config.docs} />

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
