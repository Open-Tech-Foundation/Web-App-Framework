export default function HomePage() {
  return (
    <div style="display: flex; flex-direction: column; gap: 1.5rem; align-items: center;">
      <h1 style="font-size: 2.5rem; margin: 0;">MWAF</h1>
      <p style="font-size: 1.25rem; color: #71717a; max-width: 450px; line-height: 1.6;">
        A high-performance, zero-VDOM framework built on standard Web Components and fine-grained reactivity.
      </p>

      <div style="margin-top: 1rem; padding: 1rem; border: 1px solid #e4e4e7; border-radius: 0.75rem; background: #fafafa; width: 100%;">
        <p style="margin: 0; font-family: monospace; color: #3f3f46;">
          Edit <span style="color: #09090b; font-weight: 600;">app/page.jsx</span> to get started
        </p>
      </div>
    </div>
  );
}
