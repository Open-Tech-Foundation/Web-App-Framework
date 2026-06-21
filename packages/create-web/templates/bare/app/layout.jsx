import { Link } from "@opentf/web";

export default function RootLayout(props) {
  return (
    <div class="app">
      <nav class="nav">
        <Link href="/" class="brand">OpenTF Web</Link>
        <Link href="/about" class="nav-link">About</Link>
      </nav>
      <main class="main">{props.children}</main>
    </div>
  );
}
