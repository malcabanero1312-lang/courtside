import Link from "next/link";

export default function NotFound() {
  return (
    <main className="portal">
      <div className="portal-card card card-pad" style={{ textAlign: "center", alignSelf: "center" }}>
        <h1 className="display" style={{ fontSize: 28, marginBottom: 8 }}>Page not found</h1>
        <p className="muted" style={{ marginBottom: 18 }}>The page you were looking for doesn't exist or was moved.</p>
        <Link href="/dashboard" className="btn primary">Go to dashboard</Link>
      </div>
    </main>
  );
}
