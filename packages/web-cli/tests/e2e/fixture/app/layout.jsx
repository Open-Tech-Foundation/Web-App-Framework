// Site-wide, route-independent metadata. No `titleTemplate` on purpose: `/about`'s
// `generateMetadata` returns a full title and the serve e2e asserts it verbatim.
// The `links` cover both a favicon and a typed feed alternate (exercises links[].type).
export const metadata = {
  description: "E2E fixture site.",
  openGraph: { siteName: "E2E Fixture", type: "website" },
  links: [
    { rel: "icon", href: "/favicon.svg" },
    { rel: "alternate", type: "application/rss+xml", href: "/rss.xml" },
  ],
};

export default function Layout({ children }) {
  return (
    <div class="layout">
      <header class="site-header">E2E_LAYOUT</header>
      {children}
    </div>
  );
}
