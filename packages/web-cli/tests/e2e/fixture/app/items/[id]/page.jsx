import { router } from "@opentf/web";

export default function Item() {
  return (
    <main>
      <h1>E2E_ITEM</h1>
      <p class="item-id">ITEM {router.data ? router.data.id : "none"}</p>
    </main>
  );
}

// SSG expansion for the dynamic route (used by the build --ssg e2e).
export function getStaticPaths() {
  return [{ params: { id: "7" } }];
}
