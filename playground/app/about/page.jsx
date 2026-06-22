import { Link } from "@opentf/web";

export const metadata = {
  title: "About OTF Web",
  description:
    "OTF Web is a zero-VDOM, high-performance fullstack framework built on native Web Components and signals.",
  canonical: "/about",
  openGraph: { image: "/og/about.png" },
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About OTF Web",
  },
};

export default function AboutPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">About OTF Web</h1>
      <p className="text-slate-300">This framework is strictly structured to provide a zero-VDOM, high-performance experience using native Web Components.</p>
      <Link href="/" className="text-blue-400 hover:underline inline-block">Go Back Home</Link>
    </div>
  )
}
