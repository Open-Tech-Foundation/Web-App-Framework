// A reusable rating control. It talks to the outside world two ways at once —
// the hybrid event model:
//   • callback prop  — `props.onChange?.(n)` for a direct parent handler.
//   • dispatched event — `emit(this, "rate", n)` bubbles a CustomEvent so any
//     subscriber (even another framework) can listen with addEventListener.
// A page subscribes to the event with `onRate:listen={...}` (see events-demo).

import { emit } from "@opentf/web";

export default function StarRating(props) {
  let value = $state(0);

  const pick = (n) => {
    value = n;
    props.onChange?.(n); // callback channel (parent passed onChange={...})
    emit(this, "rate", n); // event channel (parent listens onRate:listen={...})
  };

  return (
    <div class="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          onclick={() => pick(n)}
          class="text-2xl leading-none transition-transform hover:scale-125"
          aria-label={`Rate ${n}`}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}
