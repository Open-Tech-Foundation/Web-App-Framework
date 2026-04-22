import { Link } from "@opentf/mwaf-core";

export default function NotFound() {
  return (
    <div className="text-center">
      <h1 className="text-4xl font-bold text-red-500">404</h1>
      <p className="text-gray-400">This page does not exist in our galaxy.</p>
      <Link href="/" className="text-blue-400 hover:underline mt-4 inline-block">Go Home</Link>
    </div>
  );
}
