// "Last updated on <date>" line. Presentational — pass an ISO-8601 (or any
// Date-parseable) `date`; renders nothing when it's absent. The date itself comes from
// the build-time `@opentf/web-docs/updated` map (git commit time or a frontmatter
// override); layouts look up the current route there and pass it in.
//
//   import updated from "@opentf/web-docs/updated";
//   <LastUpdated date={updated[router.pathname]} />
import { formatDate } from "./format.js";

export default function LastUpdated(props) {
  const date = props.date;
  if (!date) return null;
  const label = props.label || "Last updated on";
  return (
    <div class="otfw-last-updated">
      {label}{" "}
      <time class="otfw-last-updated-time" datetime={String(date)}>
        {formatDate(date)}
      </time>
    </div>
  );
}
