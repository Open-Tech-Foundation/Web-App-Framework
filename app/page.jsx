import Profile from "./components/Profile.wc";


export default function Gallery() {
  return (
    <section>
      <h1>Amazing scientists</h1>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <Profile />
        <Profile />
        <Profile />
      </div>
    </section>
  );
}
