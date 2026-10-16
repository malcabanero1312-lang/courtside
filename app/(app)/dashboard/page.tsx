import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isStaff } from "@/lib/session";
import { APPOINTMENT_SELECT, type AppointmentWithRelations } from "@/lib/types";
import { formatDate, formatTime, firstName, relativeTime } from "@/lib/format";
import { dayRangeUtc, todayInZone } from "@/lib/time";
import { isEmailConfigured } from "@/lib/env";
import { ButtonLink, Card, CoachDot, EmptyState, Flash, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Dashboard" };

interface Summary {
  today: number;
  to_contact: number;
  awaiting: number;
  awaiting_overdue: number;
  office_pending: number;
  office_not_sent: number;
  results_to_send: number;
  reschedule_requests: number;
  declined_upcoming: number;
  to_close: number;
  failed_notifications: number;
  confirmed_week: number;
  worker_last_run: string | null;
}

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AppointmentRow({ a, tz, showDate }: { a: AppointmentWithRelations; tz: string; showDate?: boolean }) {
  return (
    <Link href={`/appointments/${a.id}`} className="list-item">
      <div className="time-block">
        <strong>{formatTime(a.starts_at, tz)}</strong>
        <span className="small muted">{showDate ? formatDate(a.starts_at, tz, "short") : formatTime(a.ends_at, tz)}</span>
      </div>
      <div className="grow">
        <div style={{ fontWeight: 600 }} className="truncate">
          {a.student?.full_name}
        </div>
        <div className="small muted row truncate" style={{ gap: 6 }}>
          <CoachDot color={a.coach?.color} />
          {a.coach?.full_name} · {a.venue?.name}
          {a.court ? `, ${a.court.name}` : ""}
        </div>
      </div>
      <StatusBadge status={a.status} />
    </Link>
  );
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership } = await requireSession();
  const staff = isStaff(membership.role);
  const tz = org.timezone;
  const today = todayInZone(tz);
  const range = dayRangeUtc(today, tz);
  const now = new Date().toISOString();

  const [summaryRes, todayRes, attentionRes, setupRes] = await Promise.all([
    supabase.rpc("dashboard_summary", { p_org: org.id }),
    supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .eq("org_id", org.id)
      .gte("starts_at", range.start)
      .lt("starts_at", range.end)
      .not("status", "in", "(rescheduled,cancelled,declined,not_approved)")
      .order("starts_at"),
    staff
      ? supabase
          .from("appointments")
          .select(APPOINTMENT_SELECT)
          .eq("org_id", org.id)
          .or(
            [
              "status.eq.reschedule_requested",
              `and(status.eq.pending_approval,starts_at.gte."${now}")`,
              `and(status.in.(confirmed,not_approved),student_informed_at.is.null,starts_at.gte."${now}")`,
              `and(status.eq.scheduled,starts_at.gte."${now}")`,
              `and(status.eq.awaiting_response,starts_at.gte."${now}")`
            ].join(",")
          )
          .order("starts_at")
          .limit(12)
      : supabase
          .from("appointments")
          .select(APPOINTMENT_SELECT)
          .eq("org_id", org.id)
          .gte("starts_at", range.end)
          .not("status", "in", "(rescheduled,cancelled,declined,not_approved)")
          .order("starts_at")
          .limit(10),
    staff
      ? Promise.all([
          supabase.from("venues").select("id", { count: "exact", head: true }).eq("org_id", org.id),
          supabase.from("coaches").select("id", { count: "exact", head: true }).eq("org_id", org.id),
          supabase.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", org.id),
          supabase.from("appointments").select("id", { count: "exact", head: true }).eq("org_id", org.id)
        ])
      : Promise.resolve(null)
  ]);

  const summary = (summaryRes.data ?? {}) as Summary;
  const todays = (todayRes.data ?? []) as unknown as AppointmentWithRelations[];
  const attention = (attentionRes.data ?? []) as unknown as AppointmentWithRelations[];

  const setup = setupRes
    ? {
        venues: setupRes[0].count ?? 0,
        coaches: setupRes[1].count ?? 0,
        team: setupRes[2].count ?? 0,
        appointments: setupRes[3].count ?? 0
      }
    : null;
  const setupSteps = setup
    ? [
        { done: setup.venues > 0, label: "Add your venue and courts", href: "/venues" },
        { done: setup.coaches > 0, label: "Add your coaches and their working hours", href: "/coaches" },
        { done: setup.team > 1, label: "Invite agents or coaches to log in (optional)", href: "/team" },
        { done: setup.appointments > 0, label: "Book your first appointment", href: "/appointments/new" }
      ]
    : [];
  const setupIncomplete = membership.role === "admin" && setupSteps.some((s) => !s.done);

  const workerStale =
    staff &&
    isEmailConfigured() &&
    (!summary.worker_last_run || Date.now() - new Date(summary.worker_last_run).getTime() > 26 * 3600 * 1000);

  return (
    <>
      <Flash params={params} />
      <PageHeader
        eyebrow={formatDate(new Date().toISOString(), tz)}
        title={`${greeting(tz)}, ${firstName(membership.full_name) || "there"}`}
        subtitle={
          staff
            ? summary.reschedule_requests || summary.awaiting_overdue || summary.to_close || summary.office_not_sent || summary.results_to_send
              ? "A few things need your attention today."
              : "Everything is on track."
            : "Here are your sessions."
        }
        actions={staff ? <ButtonLink href="/appointments/new" variant="primary" icon="plus">New appointment</ButtonLink> : null}
      />

      {setupIncomplete ? (
        <Card title="Get set up" className="anim-in" actions={<span className="small muted">{setupSteps.filter((s) => s.done).length} of {setupSteps.length} done</span>}>
          <ul className="checklist">
            {setupSteps.map((step) => (
              <li key={step.label}>
                <span className={`check-circle ${step.done ? "done" : ""}`}>{step.done ? <Icon name="check" size={13} /> : null}</span>
                <span className="grow" style={{ textDecoration: step.done ? "line-through" : undefined, color: step.done ? "var(--muted)" : undefined }}>
                  {step.label}
                </span>
                {!step.done ? (
                  <Link href={step.href} className="btn small">
                    Open <Icon name="arrowRight" size={14} />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {staff && !isEmailConfigured() ? (
        <Notice tone="info">
          Email updates are not switched on yet, so confirmations and reminders are recorded but not emailed. WhatsApp messages
          and the student response page work normally. See <strong>SETUP.md → Email</strong> to turn emails on.
        </Notice>
      ) : null}
      {workerStale ? (
        <Notice tone="warn">
          The scheduled email job hasn't run in the last day, so reminders and retries may be delayed. Check the cron setup in
          SETUP.md, or press “Send now” on the <Link className="link" href="/notifications">Emails</Link> page.
        </Notice>
      ) : null}

      <div className="kpis" style={{ marginTop: setupIncomplete ? 18 : 0 }}>
        <Link href="/calendar" className="card kpi accent">
          <span className="kpi-label">Sessions today</span>
          <span className="kpi-value">{staff ? summary.today ?? todays.length : todays.length}</span>
        </Link>
        {staff ? (
          <>
            <Link href="/appointments?view=to_contact" className="card kpi">
              <span className="kpi-label">To contact</span>
              <span className="kpi-value">{summary.to_contact ?? 0}</span>
            </Link>
            <Link href="/appointments?view=awaiting" className="card kpi">
              <span className="kpi-label">Awaiting reply</span>
              <span className="kpi-value">{summary.awaiting ?? 0}</span>
              {summary.awaiting_overdue ? <span className="kpi-note">{summary.awaiting_overdue} need a follow-up</span> : null}
            </Link>
            <Link href="/appointments?view=office" className="card kpi">
              <span className="kpi-label">Waiting for office</span>
              <span className="kpi-value">{summary.office_pending ?? 0}</span>
              {summary.office_not_sent ? <span className="kpi-note">{summary.office_not_sent} not sent to the office yet</span> : null}
            </Link>
            <Link href="/appointments?view=tell_student" className="card kpi">
              <span className="kpi-label">Tell student the result</span>
              <span className="kpi-value">{summary.results_to_send ?? 0}</span>
            </Link>
            <Link href="/appointments?view=reschedule" className="card kpi">
              <span className="kpi-label">New time requested</span>
              <span className="kpi-value">{summary.reschedule_requests ?? 0}</span>
            </Link>
          </>
        ) : null}
        {staff ? (
          <Link href="/appointments?view=confirmed" className="card kpi">
            <span className="kpi-label">Confirmed, next 7 days</span>
            <span className="kpi-value">{summary.confirmed_week ?? 0}</span>
          </Link>
        ) : null}
        {staff && summary.to_close ? (
          <Link href="/appointments?view=to_close" className="card kpi">
            <span className="kpi-label">Past sessions to close</span>
            <span className="kpi-value">{summary.to_close}</span>
          </Link>
        ) : null}
        {staff && summary.failed_notifications ? (
          <Link href="/notifications?status=failed" className="card kpi">
            <span className="kpi-label">Emails that failed</span>
            <span className="kpi-value" style={{ color: "var(--red)" }}>
              {summary.failed_notifications}
            </span>
          </Link>
        ) : null}
      </div>

      <div className="grid two">
        <Card
          title="Today's schedule"
          actions={
            <Link href="/calendar" className="small link">
              Week view
            </Link>
          }
        >
          {todays.length === 0 ? (
            <EmptyState icon="calendar" title="No sessions today" body="Enjoy the quiet — or book someone in." />
          ) : (
            <div className="list">
              {todays.map((a) => (
                <AppointmentRow key={a.id} a={a} tz={tz} />
              ))}
            </div>
          )}
        </Card>

        <Card
          title={staff ? "Needs attention" : "Coming up"}
          actions={
            <Link href={staff ? "/appointments?view=to_contact" : "/appointments"} className="small link">
              See all
            </Link>
          }
        >
          {attention.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title={staff ? "All caught up" : "Nothing scheduled"}
              body={staff ? "Every upcoming student has been contacted and nobody is waiting on you." : "New sessions will show up here."}
            />
          ) : (
            <div className="list">
              {attention.map((a) => (
                <div key={a.id} style={{ position: "relative" }}>
                  <AppointmentRow a={a} tz={tz} showDate />
                  {staff && a.status === "awaiting_response" && a.contacted_at ? (
                    <div className="small muted" style={{ padding: "0 20px 10px 108px", marginTop: -8 }}>
                      Messaged {relativeTime(a.contacted_at)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
