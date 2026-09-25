import { Link } from "@opentf/web";

export const metadata = {
  title: "Page not found",
  description: "The page you requested does not exist.",
  robots: "noindex",
};

export default function NotFound() {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-black tracking-tight text-[var(--text-main)]">404</h1>
      <p className="text-[var(--text-muted)] mt-2">This page does not exist.</p>
      <Link href="/" className="text-[var(--accent)] underline mt-4 inline-block">
        Go home
      </Link>
    </div>
  );
}
