import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { addDays, todayInZone, zonedToUtc } from "@/lib/time";
import { Card, EmptyState, PageHeader, one } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };

const RANGES = [
  { key: "7", label: "Last 7 days", back: 7, ahead: 0 },
  { key: "30", label: "Last 30 days", back: 30, ahead: 0 },
  { key: "90", label: "Last 90 days", back: 90, ahead: 0 },
  { key: "next30", label: "Next 30 days", back: 0, ahead: 30 }
];

interface Report {
  totals: {
    total: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    declined: number;
    no_show: number;
    rescheduled: number;
    responded: number;
    contacted: number;
    hours_delivered: number;
  };
  by_coach: { name: string; sessions: number; hours: number; cancelled: number; no_shows: number }[];
  by_agent: { name: string; created: number; confirmed: number; contacted: number }[];
  by_day: { day: string; booked: number; lost: number }[];
  notifications: { sent: number; failed: number; skipped: number };
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export default async function ReportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const range = RANGES.find((r) => r.key === one(params.range)) ?? RANGES[1];
  const today = todayInZone(org.timezone);
  const fromDate = addDays(today, -range.back);
  const toDate = addDays(today, range.ahead + 1);
  const { data, error } = await supabase.rpc("org_report", {
    p_org: org.id,
    p_from: zonedToUtc(fromDate, "00:00", org.timezone).toISOString(),
    p_to: zonedToUtc(toDate, "00:00", org.timezone).toISOString()
  });
  const report = data as Report | null;

  const t = report?.totals;
  const answered = t ? t.confirmed + t.completed + t.no_show + t.declined : 0;
  const maxDay = Math.max(1, ...(report?.by_day ?? []).map((d) => d.booked));
  const maxHours = Math.max(1, ...(report?.by_coach ?? []).map((c) => Number(c.hours)));

  return (
    <>
      <PageHeader title="Reports" subtitle="How bookings, confirmations and coaches are performing." />
      <nav className="tabs">
        {RANGES.map((r) => (
          <Link key={r.key} href={`/reports?range=${r.key}`} className={`tab ${r.key === range.key ? "active" : ""}`}>
            {r.label}
          </Link>
        ))}
      </nav>

      {error || !report || !t ? (
        <Card>
          <EmptyState icon="chart" title="Reports aren't available right now" body="Please refresh the page in a moment." />
        </Card>
      ) : (
        <div className="stack">
          <div className="kpis" style={{ marginBottom: 0 }}>
            <div className="card kpi accent">
              <span className="kpi-label">Sessions booked</span>
              <span className="kpi-value">{t.total}</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Confirmation rate</span>
              <span className="kpi-value">{pct(t.confirmed + t.completed + t.no_show, answered)}</span>
              <span className="small muted">of students who answered</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Reply rate</span>
              <span className="kpi-value">{pct(t.responded, t.contacted)}</span>
              <span className="small muted">replied online after being messaged</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Cancelled or declined</span>
              <span className="kpi-value">{t.cancelled + t.declined}</span>
              <span className="small muted">{pct(t.cancelled + t.declined, t.total)} of bookings</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">No-shows</span>
              <span className="kpi-value">{t.no_show}</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Coaching hours delivered</span>
              <span className="kpi-value">{t.hours_delivered}</span>
            </div>
          </div>

          <Card title="Bookings by day" actions={<span className="small muted">green booked · orange lost</span>}>
            {report.by_day.length === 0 ? (
              <div className="card-body small muted">No sessions in this period.</div>
            ) : (
              <div className="card-body">
                <div className="bars" role="img" aria-label="Bookings per day">
                  {report.by_day.map((d) => (
                    <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", gap: 2 }} title={`${d.day}: ${d.booked} booked, ${d.lost} lost`}>
                      {d.lost ? <div className="bar lost" style={{ height: `${(d.lost / maxDay) * 100}%`, borderRadius: 4 }} /> : null}
                      <div className="bar" style={{ height: `${((d.booked - d.lost) / maxDay) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="row between small muted" style={{ marginTop: 6 }}>
                  <span>{report.by_day[0]?.day}</span>
                  <span>{report.by_day[report.by_day.length - 1]?.day}</span>
                </div>
              </div>
            )}
          </Card>

          <div className="grid two">
            <Card title="Coach utilisation">
              {report.by_coach.length === 0 ? (
                <div className="card-body small muted">No coaches yet.</div>
              ) : (
                <div className="list">
                  {report.by_coach.map((c) => (
                    <div key={c.name} className="list-item" style={{ display: "block" }}>
                      <div className="row between">
                        <strong>{c.name}</strong>
                        <span className="small muted">
                          {c.hours} h · {c.sessions} sessions{c.no_shows ? ` · ${c.no_shows} no-show` : ""}
                          {c.cancelled ? ` · ${c.cancelled} cancelled` : ""}
                        </span>
                      </div>
                      <div className="meter" style={{ marginTop: 8 }}>
                        <span style={{ width: `${(Number(c.hours) / maxHours) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Agent workload">
              {report.by_agent.length === 0 ? (
                <div className="card-body small muted">No agents yet.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Handled</th>
                        <th>Contacted</th>
                        <th>Confirmed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.by_agent.map((a) => (
                        <tr key={a.name}>
                          <td className="cell-main">{a.name}</td>
                          <td>{a.created}</td>
                          <td>{a.contacted}</td>
                          <td>
                            {a.confirmed} <span className="cell-sub">({pct(a.confirmed, a.created)})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card title="Emails in this period" padded>
            <div className="row wrap" style={{ gap: 24 }}>
              <span>
                <strong>{report.notifications.sent}</strong> <span className="muted">sent</span>
              </span>
              <span>
                <strong>{report.notifications.failed}</strong> <span className="muted">failed</span>
              </span>
              <span>
                <strong>{report.notifications.skipped}</strong> <span className="muted">not sent (no email address or emails off)</span>
              </span>
              <Link href="/notifications" className="link small">
                Open email log
              </Link>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
