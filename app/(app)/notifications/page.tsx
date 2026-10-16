import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { isEmailConfigured } from "@/lib/env";
import { hasAdminClient } from "@/lib/supabase/admin";
import { Card, EmptyState, Flash, Notice, PageHeader, one } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { retryNotification, runNow } from "./actions";

export const metadata: Metadata = { title: "Emails" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "failed", label: "Failed" },
  { key: "pending", label: "Waiting" },
  { key: "sent", label: "Sent" },
  { key: "skipped", label: "Not sent" }
];

const TONE: Record<string, string> = {
  sent: "tone-green",
  pending: "tone-slate",
  sending: "tone-slate",
  failed: "tone-red",
  dead: "tone-red",
  skipped: "tone-muted"
};

const LABEL: Record<string, string> = {
  sent: "Sent",
  pending: "Waiting",
  sending: "Sending",
  failed: "Failed – will retry",
  dead: "Failed",
  skipped: "Not sent"
};

export default async function NotificationsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const status = one(params.status);
  let query = supabase
    .from("notifications")
    .select("*, appointment:appointments(id, reference, student:students(full_name))")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(150);
  if (status === "failed") query = query.in("status", ["failed", "dead"]);
  else if (status === "pending") query = query.in("status", ["pending", "sending"]);
  else if (status) query = query.eq("status", status);
  const { data } = await query;
  const rows = (data ?? []) as {
    id: string;
    template_key: string;
    recipient_type: string;
    recipient_email: string | null;
    subject: string | null;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
    sent_at: string | null;
    appointment: { id: string; reference: string; student: { full_name: string } | null } | null;
  }[];

  const { data: worker } = await supabase.rpc("dashboard_summary", { p_org: org.id });
  const lastRun = (worker as { worker_last_run?: string | null } | null)?.worker_last_run ?? null;

  return (
    <>
      <Flash params={params} />
      <PageHeader
        title="Emails"
        subtitle="Every automatic email, whether it was sent, and why not if it wasn't."
        actions={
          <>
            <form action={retryNotification}>
              <input type="hidden" name="id" value="all-failed" />
              <SubmitButton size="small" icon="refresh">Retry all failed</SubmitButton>
            </form>
            <form action={runNow}>
              <SubmitButton size="small" variant="primary" icon="send" pendingText="Sending…">Send now</SubmitButton>
            </form>
          </>
        }
      />

      {!isEmailConfigured() ? (
        <Notice tone="info">
          Email sending isn't connected yet, so emails are logged here as “Not sent”. Add <code>RESEND_API_KEY</code> and{" "}
          <code>EMAIL_FROM</code> (see SETUP.md), then use “Retry” to send them.
        </Notice>
      ) : null}
      {!hasAdminClient() ? (
        <Notice tone="error">
          <code>SUPABASE_SERVICE_ROLE_KEY</code> is missing on the server, so emails can't be processed.
        </Notice>
      ) : null}
      <p className="small muted" style={{ marginBottom: 12 }}>
        Last automatic run: {lastRun ? formatDateTime(lastRun, org.timezone) : "never"}
      </p>

      <nav className="tabs">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key ? `/notifications?status=${f.key}` : "/notifications"} className={`tab ${status === f.key ? "active" : ""}`}>
            {f.label}
          </Link>
        ))}
      </nav>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon="mail" title="No emails here" body="Emails appear when students respond, sessions are cancelled or moved, and before sessions as reminders." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Email</th>
                  <th>To</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td className="cell-sub nowrap">{formatDateTime(n.created_at, org.timezone)}</td>
                    <td>
                      <div className="cell-main">{n.subject || n.template_key.replace(/_/g, " ")}</div>
                      {n.appointment ? (
                        <Link className="cell-sub link" href={`/appointments/${n.appointment.id}`}>
                          {n.appointment.reference} · {n.appointment.student?.full_name}
                        </Link>
                      ) : null}
                    </td>
                    <td>
                      <div style={{ textTransform: "capitalize" }}>{n.recipient_type}</div>
                      <div className="cell-sub">{n.recipient_email ?? "—"}</div>
                    </td>
                    <td>
                      <span className={`badge plain ${TONE[n.status] ?? "tone-slate"}`}>{LABEL[n.status] ?? n.status}</span>
                      {n.last_error && n.status !== "sent" ? (
                        <div className="small" style={{ color: "var(--ink-2)", maxWidth: 320, marginTop: 4 }}>
                          {n.last_error}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {["failed", "dead", "skipped"].includes(n.status) ? (
                        <form action={retryNotification}>
                          <input type="hidden" name="id" value={n.id} />
                          <SubmitButton size="small">Retry</SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
