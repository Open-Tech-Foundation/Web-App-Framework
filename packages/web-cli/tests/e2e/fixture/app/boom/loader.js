// A loader that throws — the SSR server must 500 the page and the data endpoint.
export default function loader() {
  throw new Error("E2E_BOOM_LOADER");
}
