// Harness component for the hydration e2e: the docs site's own call site
// (website/app/docs/layout.jsx) reduced to one file — `<DocsLayout frame={false}>` with
// light-DOM children.
//
// It is compiled twice by tests/e2e/hydration.mjs (otfwc `--target=ssg` for the server HTML,
// `--target=hydrate` for the client), so the adopt walk runs against markup the real SSG
// backend produced from these exact sources.

import DocsLayout from "../../components/DocsLayout.jsx";

// A non-empty nav matters: `<Sidebar>` renders a `<Link>` island per entry, and each of those
// emits its own `<!--c[-->` slot markers *before* the prose slot in tree order. That is the
// shape that broke the live docs site — with an empty nav the sidebar emits no markers and the
// bug hides. Keep entries here whenever this harness is touched.
const NAV = [
  { title: "Introduction", path: "/docs" },
  {
    title: "Array",
    items: [
      { title: "first", path: "/docs/array/first" },
      { title: "last", path: "/docs/array/last" },
    ],
  },
];

export default function DocsHarness(props) {
  return (
    <DocsLayout config={props.config} frame={props.frame} nav={NAV}>
      <h1 class="probe-heading">Hydration probe</h1>
      <p class="probe-body">Slotted paragraph</p>
    </DocsLayout>
  );
}
