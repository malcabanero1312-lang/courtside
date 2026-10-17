import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isStaff } from "@/lib/session";
import { APPOINTMENT_SELECT, type AppointmentWithRelations } from "@/lib/types";
import { formatDate, formatTime, firstName } from "@/lib/format";
import { dayRangeUtc, todayInZone } from "@/lib/time";
import { isEmailConfigured } from "@/lib/env";
import { ButtonLink, Card, CoachDot, EmptyState, Flash, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Dashboard" };

interface Summary {
  today: number;
  to_contact: number;
  scheduled_later: number;
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
      ? Promise.resolve({ data: [] as never[] })
      : supabase
          .from("appointments")
          .select(APPOINTMENT_SELECT)
          .eq("org_id", org.id)
          .gte("starts_at", range.end)
          .not("status", "in", "(rescheduled,cancelled,declined,not_approved)")
          .order("starts_at")
          .limit(8),
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
  let unlinkedCoach = false;
  if (membership.role === "coach") {
    const { data: ownCoach } = await supabase.from("coaches").select("id").eq("org_id", org.id).eq("user_id", membership.user_id).maybeSingle();
    unlinkedCoach = !ownCoach;
  }
  const todays = (todayRes.data ?? []) as unknown as AppointmentWithRelations[];
  const attention = (attentionRes.data ?? []) as unknown as AppointmentWithRelations[];

  const todo = [
    { count: summary.reschedule_requests ?? 0, label: "Asked for a new time", hint: "Pick a new time and send it", href: "/appointments?view=reschedule", urgent: true },
    { count: summary.office_not_sent ?? 0, label: "Send to the office", hint: "Student confirmed — ask the office to approve", href: "/appointments?view=office", urgent: true },
    { count: summary.results_to_send ?? 0, label: "Tell the student", hint: "The office decided — send the result", href: "/appointments?view=tell_student", urgent: true },
    { count: summary.to_contact ?? 0, label: "Message the student", hint: "Due now — ask them to confirm", href: "/appointments?view=to_contact", urgent: false },
    { count: summary.awaiting_overdue ?? 0, label: "Follow up", hint: "No reply for a while", href: "/appointments?view=awaiting", urgent: false },
    {
      count: Math.max(0, (summary.office_pending ?? 0) - (summary.office_not_sent ?? 0)),
      label: "Waiting for the office",
      hint: "Sent — waiting for their answer",
      href: "/appointments?view=office",
      urgent: false
    },
    { count: summary.to_close ?? 0, label: "Close past sessions", hint: "Mark completed or no-show", href: "/appointments?view=to_close", urgent: false },
    { count: summary.failed_notifications ?? 0, label: "Emails that failed", hint: "Open the email log to retry", href: "/notifications?status=failed", urgent: false }
  ].filter((item) => item.count > 0);

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

      {unlinkedCoach ? (
        <Notice tone="warn">
          Your login isn't linked to a coach profile yet, so no sessions can be shown. Ask an admin to open{" "}
          <strong>Coaches → your name → Coach login</strong> and link your account.
        </Notice>
      ) : null}

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

      {workerStale ? (
        <Notice tone="warn">
          The scheduled email job hasn't run in the last day, so reminders and retries may be delayed. Press “Send now” on the{" "}
          <Link className="link" href="/notifications">
            Emails
          </Link>{" "}
          page.
        </Notice>
      ) : null}

      <div className="grid two" style={{ marginTop: setupIncomplete ? 18 : 0 }}>
        {staff ? (
          <Card title="To do" actions={<span className="small muted">{summary.confirmed_week ?? 0} confirmed this week</span>}>
            {todo.length === 0 ? (
              <EmptyState icon="checkCircle" title="All caught up" body="Nothing needs your attention right now." />
            ) : (
              <div className="list">
                {todo.map((item) => (
                  <Link key={item.href} href={item.href} className="list-item todo-item">
                    <span className={`todo-count ${item.urgent ? "urgent" : ""}`}>{item.count}</span>
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{item.label}</div>
                      <div className="small muted">{item.hint}</div>
                    </div>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        ) : null}

        <Card
          title={`Today · ${todays.length} session${todays.length === 1 ? "" : "s"}`}
          actions={
            <Link href="/calendar" className="small link">
              Week view
            </Link>
          }
        >
          {todays.length === 0 ? (
            <EmptyState icon="calendar" title="No sessions today" />
          ) : (
            <div className="list">
              {todays.map((a) => (
                <AppointmentRow key={a.id} a={a} tz={tz} />
              ))}
            </div>
          )}
        </Card>

        {!staff ? (
          <Card
            title="Coming up"
            actions={
              <Link href="/calendar" className="small link">
                See all
              </Link>
            }
          >
            {attention.length === 0 ? (
              <EmptyState icon="calendar" title="Nothing scheduled" />
            ) : (
              <div className="list">
                {attention.map((a) => (
                  <AppointmentRow key={a.id} a={a} tz={tz} showDate />
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
