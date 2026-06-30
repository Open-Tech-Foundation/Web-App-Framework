import { Link } from "@opentf/web";

export default function RootLayout({ children }) {
  return (
    <div class="app">
      <nav class="nav">
        <Link href="/" class="brand">OTF Web</Link>
        <Link href="/about" class="nav-link">About</Link>
        <Link href="/contact" class="nav-link">Contact</Link>
      </nav>
      <main class="main">{children}</main>
    </div>
  );
}
