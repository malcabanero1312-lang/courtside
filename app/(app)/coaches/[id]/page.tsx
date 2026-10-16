import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { APPOINTMENT_SELECT, type AppointmentWithRelations, type Coach } from "@/lib/types";
import { formatDate, formatDateTime, formatTimeRange, initials } from "@/lib/format";
import { addDays, todayInZone } from "@/lib/time";
import { Card, EmptyState, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { CoachFields } from "../coach-fields";
import { addTimeOff, deleteBlockedTime, inviteCoach, saveAvailability, updateCoach } from "../actions";

export const metadata: Metadata = { title: "Coach" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default async function CoachPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, membership, user } = await requireSession();
  const { data } = await supabase.from("coaches").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const coach = data as Coach;
  const isAdmin = membership.role === "admin";
  const isSelf = coach.user_id === user.id;
  const canEditHours = isAdmin || isSelf;
  const canBlock = membership.role !== "coach" || isSelf;
  const tz = org.timezone;

  const [availRes, blockedRes, upcomingRes, inviteRes] = await Promise.all([
    supabase.from("coach_availability").select("*").eq("coach_id", id).order("weekday").order("start_time"),
    supabase.from("blocked_times").select("*").eq("coach_id", id).gte("ends_at", new Date().toISOString()).order("starts_at"),
    supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .eq("coach_id", id)
      .gte("starts_at", new Date().toISOString())
      .in("status", ["scheduled", "awaiting_response", "confirmed", "reschedule_requested"])
      .order("starts_at")
      .limit(15),
    isAdmin
      ? supabase.from("invitations").select("id, email, created_at").eq("coach_id", id).is("accepted_at", null).is("revoked_at", null).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const availability = (availRes.data ?? []) as { weekday: number; start_time: string; end_time: string }[];
  const byDay = new Map(availability.map((a) => [a.weekday, a]));
  const blocked = (blockedRes.data ?? []) as { id: string; starts_at: string; ends_at: string; reason: string | null }[];
  const upcoming = (upcomingRes.data ?? []) as unknown as AppointmentWithRelations[];
  const invite = inviteRes.data as { id: string; email: string } | null;
  const today = todayInZone(tz);

  return (
    <>
      {membership.role !== "coach" ? (
        <div className="row small" style={{ marginBottom: 10 }}>
          <Link href="/coaches" className="muted row" style={{ gap: 4 }}>
            <Icon name="chevronLeft" size={15} /> Coaches
          </Link>
        </div>
      ) : null}
      <Flash params={sp} />
      <PageHeader
        title={
          <span className="row">
            <span className="avatar" style={{ background: coach.color, color: "#fff", width: 40, height: 40, fontSize: 14 }}>
              {initials(coach.full_name)}
            </span>
            {coach.full_name}
          </span>
        }
        subtitle={[coach.specialties, coach.is_active ? null : "Inactive"].filter(Boolean).join(" · ") || undefined}
        actions={
          <Link className="btn" href={`/calendar?coach=${coach.id}`}>
            <Icon name="calendar" size={16} /> Calendar
          </Link>
        }
      />

      <div className="grid main-side">
        <div className="stack">
          <Card title="Weekly working hours">
            <form action={saveAvailability}>
              <input type="hidden" name="coach_id" value={coach.id} />
              <div className="list">
                {ORDER.map((weekday) => {
                  const slot = byDay.get(weekday);
                  return (
                    <div key={weekday} className="list-item" style={{ padding: "10px 20px" }}>
                      <label className="check" style={{ width: 140 }}>
                        <input type="checkbox" name={`on_${weekday}`} defaultChecked={Boolean(slot)} disabled={!canEditHours} />
                        {DAYS[weekday]}
                      </label>
                      <input
                        className="input"
                        type="time"
                        name={`start_${weekday}`}
                        defaultValue={slot?.start_time?.slice(0, 5) ?? "07:00"}
                        style={{ width: 130 }}
                        disabled={!canEditHours}
                        aria-label={`${DAYS[weekday]} start`}
                      />
                      <span className="muted">to</span>
                      <input
                        className="input"
                        type="time"
                        name={`end_${weekday}`}
                        defaultValue={slot?.end_time?.slice(0, 5) ?? "20:00"}
                        style={{ width: 130 }}
                        disabled={!canEditHours}
                        aria-label={`${DAYS[weekday]} end`}
                      />
                    </div>
                  );
                })}
              </div>
              {canEditHours ? (
                <div className="row between wrap" style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
                  <span className="small muted">Bookings outside these hours show a warning but can still be saved.</span>
                  <SubmitButton variant="primary" size="small">Save hours</SubmitButton>
                </div>
              ) : null}
            </form>
          </Card>

          <Card title="Upcoming sessions">
            {upcoming.length === 0 ? (
              <EmptyState icon="calendar" title="Nothing booked" />
            ) : (
              <div className="list">
                {upcoming.map((a) => (
                  <Link key={a.id} href={`/appointments/${a.id}`} className="list-item">
                    <div style={{ width: 130 }} className="nowrap">
                      <div style={{ fontWeight: 600 }}>{formatDate(a.starts_at, tz, "short")}</div>
                      <div className="small muted mono">{formatTimeRange(a.starts_at, a.ends_at, tz)}</div>
                    </div>
                    <div className="grow truncate">
                      {a.student?.full_name}
                      <span className="small muted"> · {a.venue?.name}</span>
                    </div>
                    <StatusBadge status={a.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="stack">
          <Card title="Time off">
            {blocked.length === 0 ? (
              <div className="card-body small muted">No upcoming time off.</div>
            ) : (
              <div className="list">
                {blocked.map((b) => (
                  <div key={b.id} className="list-item" style={{ padding: "10px 16px" }}>
                    <div className="grow small">
                      <div style={{ fontWeight: 600 }}>
                        {formatDateTime(b.starts_at, tz)} → {formatDateTime(b.ends_at, tz)}
                      </div>
                      {b.reason ? <div className="muted">{b.reason}</div> : null}
                    </div>
                    {canBlock ? (
                      <form action={deleteBlockedTime}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="return_to" value={`/coaches/${coach.id}`} />
                        <SubmitButton size="small" variant="ghost" icon="trash" confirmText="Remove this time off?">
                          <span className="sr-only">Remove</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {canBlock ? (
              <form action={addTimeOff} className="card-body stack" style={{ borderTop: "1px solid var(--line)" }}>
                <input type="hidden" name="coach_id" value={coach.id} />
                <div className="form-grid">
                  <label className="field">
                    <span>From</span>
                    <input className="input" type="date" name="start_date" defaultValue={addDays(today, 1)} required />
                  </label>
                  <label className="field">
                    <span>Until</span>
                    <input className="input" type="date" name="end_date" defaultValue={addDays(today, 1)} />
                  </label>
                  <label className="field">
                    <span>Start time</span>
                    <input className="input" type="time" name="start_time" defaultValue="08:00" />
                  </label>
                  <label className="field">
                    <span>End time</span>
                    <input className="input" type="time" name="end_time" defaultValue="12:00" />
                  </label>
                </div>
                <label className="check small">
                  <input type="checkbox" name="all_day" /> Whole days
                </label>
                <input className="input" name="reason" placeholder="Reason (optional), e.g. Tournament" maxLength={200} />
                <SubmitButton size="small" icon="plus">Add time off</SubmitButton>
              </form>
            ) : null}
          </Card>

          {isAdmin ? (
            <Card title="Profile" padded>
              <form action={updateCoach} className="stack">
                <input type="hidden" name="id" value={coach.id} />
                <CoachFields coach={coach} showActive />
                <SubmitButton variant="primary">Save</SubmitButton>
              </form>
            </Card>
          ) : null}

          {isAdmin ? (
            <Card title="Coach login" padded>
              {coach.user_id ? (
                <p className="small muted">This coach can log in to see their schedule and manage their hours.</p>
              ) : invite ? (
                <p className="small muted">
                  Invitation waiting for <strong>{invite.email}</strong>. They just need to sign up with that email.
                </p>
              ) : (
                <form action={inviteCoach} className="stack tight">
                  <input type="hidden" name="coach_id" value={coach.id} />
                  <p className="small muted">Let this coach log in to see their sessions, mark attendance and set their hours.</p>
                  <SubmitButton size="small" icon="send" disabled={!coach.email}>
                    Invite to log in
                  </SubmitButton>
                  {!coach.email ? <span className="small faint">Add an email address first.</span> : null}
                </form>
              )}
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
