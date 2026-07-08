import { Navbar } from "@opentf/web-docs";
import config from "../otfw.config.js";

const OTF_ORG = "https://opentechf.org/";

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
  links: [
    { rel: "icon", href: "/img/otf-logo.svg" },
    { rel: "apple-touch-icon", href: "/img/otf-logo.svg" },
  ],
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

      <footer className="py-12 border-t border-[var(--border)] flex justify-start items-center px-8 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] mt-auto transition-colors">
        <a
          href={OTF_ORG}
          target="_blank"
          rel="noreferrer"
          class="otfw-footer-org-link"
        >
          <img
            src="/img/otf-logo.svg"
            alt=""
            width="24"
            height="24"
            class="otfw-footer-org-logo"
          />
          <span>© Open Tech Foundation</span>
        </a>
      </footer>
    </div>
  );
}
