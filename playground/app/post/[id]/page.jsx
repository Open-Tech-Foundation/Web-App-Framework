// Enumerate the dynamic paths to pre-render at build time (SSG). Without this the
// route is skipped (client renders it at runtime).
export function getStaticPaths() {
  return [{ params: { id: "1" } }, { params: { id: "2" } }, { params: { id: "3" } }];
}

// Per-path metadata for the pre-rendered `<head>` (title/description/canonical).
export function generateMetadata({ params }) {
  return {
    title: `Post ${params.id} — OTF Web`,
    description: `Dynamic post page for ID ${params.id}.`,
    canonical: `/post/${params.id}`,
  };
}

export default function PostPage(props) {
  onMount(() => {
    console.log(`Post page mounted with ID: ${props.params.id}`)
  })

  onCleanup(() => {
    console.log(`Post page cleaned up with ID: ${props.params.id}`)
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">Post {props.params.id}</h1>
      <p className="mt-4">This is a dynamic post page for ID: <span className="font-mono bg-gray-200 px-1">{props.params.id}</span></p>
    </div>
  );
}
