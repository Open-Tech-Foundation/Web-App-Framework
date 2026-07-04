import { notFound } from "@opentf/web/server";

export default function loader({ params }) {
  if (params.id === "missing") notFound();
  return { id: params.id };
}
