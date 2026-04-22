import { Link } from "@opentf/mwaf-core";

export default function AboutPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">About MWAF</h1>
      <p className="text-slate-300">This framework is strictly structured to provide a zero-VDOM, high-performance experience using native Web Components.</p>
      <Link href="/" className="text-blue-400 hover:underline inline-block">Go Back Home</Link>
    </div>
  )
}
