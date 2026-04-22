export default function RootLayout({ children }) {
  return (
    <div style="max-width: 600px; margin: 0 auto; padding: 2rem; text-align: center;">
      <main>
        {children}
      </main>
    </div>
  );
}
