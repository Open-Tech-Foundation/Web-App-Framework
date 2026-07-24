// Harness component for the hydration e2e: the docs site's own call site
// (website/app/docs/layout.jsx) reduced to one file — `<DocsLayout frame={false}>` with
// light-DOM children.
//
// It is compiled twice by tests/e2e/hydration.mjs (otfwc `--target=ssg` for the server HTML,
// `--target=hydrate` for the client), so the adopt walk runs against markup the real SSG
// backend produced from these exact sources.

import DocsLayout from "../../components/DocsLayout.jsx";

export default function DocsHarness(props) {
  return (
    <DocsLayout config={props.config} frame={props.frame}>
      <h1 class="probe-heading">Hydration probe</h1>
      <p class="probe-body">Slotted paragraph</p>
    </DocsLayout>
  );
}
