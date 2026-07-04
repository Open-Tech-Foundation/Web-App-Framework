import { router } from "@opentf/web";

export default function Todos() {
  return (
    <main>
      <h1>E2E_TODOS</h1>
      <ul class="todos">
        {(router.data ? router.data.items : []).map((t) => (
          <li>todo {t}</li>
        ))}
      </ul>
      <p class="q">q:{router.data ? router.data.q : ""}</p>
    </main>
  );
}
