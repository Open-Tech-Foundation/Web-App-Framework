export default function AboutPage() {
  return (
    <div>
      <h1>About Page</h1>
      <p>This is a custom JSX framework!</p>
      <a href="/" onclick={(e) => {
        e.preventDefault()
        import("../../framework/router/index").then(m => m.navigate("/", document.getElementById("app")))
      }}>Go Back Home</a>
    </div>
  )
}
