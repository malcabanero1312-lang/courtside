import { redirect } from "next/navigation";
import { isEmailConfigured, isSupabaseConfigured, serviceRoleKey } from "@/lib/env";

export const dynamic = "force-dynamic";

function Row({ ok, label, help }: { ok: boolean; label: string; help: string }) {
  return (
    <li>
      <span className={`check-circle ${ok ? "done" : ""}`}>{ok ? "✓" : ""}</span>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="small muted">{help}</div>
      </div>
    </li>
  );
}

export default function SetupPage() {
  const supabase = isSupabaseConfigured();
  if (supabase && serviceRoleKey()) {
    redirect("/login");
  }
  return (
    <main className="portal">
      <div className="portal-card" style={{ maxWidth: 560 }}>
        <div className="card">
          <div className="card-body stack">
            <div className="eyebrow">First-time setup</div>
            <h1 className="display" style={{ fontSize: 30 }}>Almost ready</h1>
            <p className="muted">
              Courtside needs a few settings before it can start. Add them to a file called <code>.env.local</code> in
              the project folder (or in Vercel → Project → Settings → Environment Variables), then restart the app. The
              step-by-step guide is in <code>SETUP.md</code>.
            </p>
          </div>
          <ul className="checklist">
            <Row ok={supabase} label="Supabase connection" help="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY" />
            <Row ok={Boolean(serviceRoleKey())} label="Supabase service key (server only)" help="SUPABASE_SERVICE_ROLE_KEY — used for emails and reminders" />
            <Row ok={isEmailConfigured()} label="Email sending (optional to start)" help="RESEND_API_KEY and EMAIL_FROM" />
          </ul>
        </div>
      </div>
    </main>
  );
}
