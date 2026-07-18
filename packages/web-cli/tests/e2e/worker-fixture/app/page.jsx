import { makeWorker, pixelUrl } from "./workers.js";

// Reference the worker + asset from the page so they enter the module graph. Kept
// behind a click so nothing spawns during SSR/prerender.
export default function Home() {
  const onClick = () => {
    const w = makeWorker();
    w.postMessage(1);
    fetch(pixelUrl);
  };
  return (
    <main>
      <h1>WORKER_E2E</h1>
      <button onClick={onClick}>spawn</button>
    </main>
  );
}
