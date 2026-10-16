export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div style={{ height: 34, width: 260, borderRadius: 8, background: "#ebe7dd" }} />
      <div className="card" style={{ height: 320, background: "#fbfaf6" }} />
    </div>
  );
}
