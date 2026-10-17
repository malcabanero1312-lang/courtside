import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { APPOINTMENT_SELECT, type AppointmentWithRelations, type Student } from "@/lib/types";
import { formatDate, formatTimeRange } from "@/lib/format";
import { ButtonLink, Card, CoachDot, EmptyState, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { StudentFields } from "../student-fields";
import { addRegularSlot, deleteRegularSlot, setStudentArchived, setStudentRegular, updateStudent } from "../actions";
import { WEEKDAY_NAMES, monthLabel, timeRange12 } from "@/lib/regular";
import { venueColor } from "@/lib/venue-colors";
import { todayInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Student" };

function utcMonth(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

export default async function StudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const { data } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const student = data as Student;

  const { data: apptData } = await supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("student_id", id)
    .order("starts_at", { ascending: false })
    .limit(200);
  const appointments = (apptData ?? []) as unknown as AppointmentWithRelations[];
  const [slotsRes, coachesRes, monthlyRes, venuesRes] = await Promise.all([
    supabase.from("regular_slots").select("id, weekday, start_time, end_time, coach_id").eq("student_id", id).order("weekday").order("start_time"),
    supabase.from("coaches").select("id, full_name").eq("org_id", org.id).eq("is_active", true).order("full_name"),
    supabase
      .from("monthly_confirmations")
      .select("id, month, status, entries, requested_entries")
      .eq("student_id", id)
      .gte("month", `${todayInZone(org.timezone).slice(0, 7)}-01`)
      .order("month"),
    supabase.from("venues").select("*").eq("org_id", org.id).order("name")
  ]);
  const monthly = (monthlyRes.data ?? []) as {
    id: string;
    month: string;
    status: "sent" | "confirmed" | "change_requested" | "declined";
    entries: unknown[];
    requested_entries: unknown[] | null;
  }[];
  const allVenues = (venuesRes.data ?? []) as { id: string; name: string; color?: string | null }[];
  const slots = (slotsRes.data ?? []) as { id: string; weekday: number; start_time: string; end_time: string; coach_id: string | null }[];
  const coachOptions = (coachesRes.data ?? []) as { id: string; full_name: string }[];
  const coachName = new Map(coachOptions.map((c) => [c.id, c.full_name]));
  const now = Date.now();
  const upcoming = appointments.filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "rescheduled").reverse();
  const past = appointments.filter((a) => new Date(a.starts_at).getTime() < now || a.status === "rescheduled");
  const stats = {
    completed: appointments.filter((a) => a.status === "completed").length,
    noShows: appointments.filter((a) => a.status === "no_show").length,
    cancelled: appointments.filter((a) => a.status === "cancelled" || a.status === "declined").length
  };
  const tz = org.timezone;

  const list = (items: AppointmentWithRelations[]) => (
    <div className="list">
      {items.map((a) => (
        <Link key={a.id} href={`/appointments/${a.id}`} className="list-item">
          <div style={{ width: 130 }} className="nowrap">
            <div style={{ fontWeight: 600 }}>{formatDate(a.starts_at, tz, "short")}</div>
            <div className="small muted mono">{formatTimeRange(a.starts_at, a.ends_at, tz)}</div>
          </div>
          <div className="grow small row truncate" style={{ gap: 6 }}>
            <CoachDot color={a.coach?.color} /> {a.coach?.full_name} · {a.venue?.name}
          </div>
          <StatusBadge status={a.status} />
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <div className="row small" style={{ marginBottom: 10 }}>
        <Link href="/students" className="muted row" style={{ gap: 4 }}>
          <Icon name="chevronLeft" size={15} /> Students
        </Link>
      </div>
      <Flash params={sp} />
      <PageHeader
        title={student.full_name}
        subtitle={
          [student.phone ? `+${student.phone}` : null, student.email, student.is_archived ? "Archived" : null].filter(Boolean).join(" · ") ||
          undefined
        }
        actions={
          !student.is_archived ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <form action={setStudentRegular} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={student.id} />
                <input type="hidden" name="regular" value={student.is_regular ? "0" : "1"} />
                <input type="hidden" name="return_to" value={`/students/${student.id}`} />
                <span className={`badge plain ${student.is_regular ? "tone-green" : "tone-muted"}`}>
                  {student.is_regular ? "Regular student" : "Not regular"}
                </span>
                <SubmitButton size="small" variant="ghost" pendingText="Saving…">
                  {student.is_regular ? "Make not regular" : "Make regular"}
                </SubmitButton>
              </form>
              <ButtonLink href={`/appointments/new?student=${student.id}`} variant="primary" icon="plus">
                Book a session
              </ButtonLink>
            </div>
          ) : null
        }
      />

      <div className="kpis">
        <div className="card kpi">
          <span className="kpi-label">Upcoming</span>
          <span className="kpi-value">{upcoming.length}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Completed</span>
          <span className="kpi-value">{stats.completed}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">No-shows</span>
          <span className="kpi-value">{stats.noShows}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Cancelled / declined</span>
          <span className="kpi-value">{stats.cancelled}</span>
        </div>
      </div>

      <div className="grid main-side">
        <div className="stack">
          <section id="schedule" className="card student-schedule">
            <div className="card-head">
              <div>
                <div className="card-title">Schedule</div>
                <div className="small muted">Every upcoming session, confirmed or still waiting.</div>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="badge plain tone-green">{upcoming.filter((a) => a.status === "confirmed").length} confirmed</span>
                <span className="badge plain tone-amber">
                  {upcoming.filter((a) => ["pending_approval", "scheduled", "awaiting_response", "reschedule_requested"].includes(a.status)).length} waiting
                </span>
              </div>
            </div>
            {monthly.length ? (
              <div className="card-body row wrap" style={{ gap: 8, paddingTop: 0 }}>
                {monthly.map((m) => {
                  const asked = (m.requested_entries ?? m.entries).length;
                  const label =
                    m.status === "confirmed"
                      ? `Confirmed ${m.entries.length}${m.entries.length < asked ? ` of ${asked}` : ""} dates`
                      : m.status === "sent"
                        ? "Waiting for their answer"
                        : m.status === "change_requested"
                          ? "Asked for a change"
                          : "Not continuing";
                  const tone = m.status === "confirmed" ? "green" : m.status === "sent" ? "amber" : m.status === "change_requested" ? "violet" : "muted";
                  return (
                    <Link key={m.id} href={`/regulars?month=${m.month.slice(0, 7)}`} className={`badge plain tone-${tone}`}>
                      {monthLabel(m.month.slice(0, 7))}: {label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
            {upcoming.length ? (
              <div className="list">
                {upcoming.map((a, i) => {
                  const monthKey = utcMonth(a.starts_at, tz);
                  const showMonth = i === 0 || utcMonth(upcoming[i - 1].starts_at, tz) !== monthKey;
                  const venue = allVenues.find((v) => v.id === a.venue_id);
                  return (
                    <div key={a.id}>
                      {showMonth ? <div className="schedule-month">{monthLabel(monthKey)}</div> : null}
                      <Link href={`/appointments/${a.id}`} className="list-item schedule-row">
                        <div className="schedule-when">
                          <div style={{ fontWeight: 650 }}>{formatDate(a.starts_at, tz, "short")}</div>
                          <div className="small muted mono">{formatTimeRange(a.starts_at, a.ends_at, tz)}</div>
                        </div>
                        <div className="grow small schedule-where">
                          <span className="row" style={{ gap: 6 }}>
                            <CoachDot color={a.coach?.color} /> {a.coach?.full_name}
                          </span>
                          {venue ? (
                            <span className="row muted" style={{ gap: 6 }}>
                              <span className="venue-dot" style={{ background: venueColor(venue, allVenues) }} />
                              {venue.name}
                              {a.court ? ` · ${a.court.name}` : ""}
                            </span>
                          ) : null}
                        </div>
                        <StatusBadge status={a.status} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon="calendar" title="No upcoming sessions" />
            )}
          </section>
          <Card title="History">{past.length ? list(past) : <div className="card-body muted small">No past sessions yet.</div>}</Card>
        </div>
        <aside className="stack">
          <Card title="Weekly schedule" padded>
            <div className="stack">
              <span className="small muted">Their fixed days and times. Used for the monthly request to the office.</span>
              {slotsRes.error ? (
                <span className="small faint">Run database update 0010 in Supabase to use weekly schedules.</span>
              ) : slots.length === 0 ? (
                <span className="small faint">No fixed schedule yet.</span>
              ) : (
                <div className="stack tight">
                  {slots.map((slot) => (
                    <form key={slot.id} action={deleteRegularSlot} className="row between">
                      <input type="hidden" name="id" value={slot.id} />
                      <input type="hidden" name="student_id" value={student.id} />
                      <span className="small">
                        <strong>{WEEKDAY_NAMES[slot.weekday]}s</strong> · {timeRange12(slot.start_time, slot.end_time)}
                        {slot.coach_id ? <span className="muted"> · {coachName.get(slot.coach_id) ?? "Coach"}</span> : null}
                      </span>
                      <SubmitButton size="small" variant="ghost" confirmText="Remove this from the weekly schedule?">
                        Remove
                      </SubmitButton>
                    </form>
                  ))}
                </div>
              )}
              {!slotsRes.error ? (
                <form action={addRegularSlot} className="stack tight">
                  <input type="hidden" name="student_id" value={student.id} />
                  <div className="form-grid">
                    <label className="field">
                      <span>Day</span>
                      <select className="input" name="weekday" defaultValue="0">
                        {WEEKDAY_NAMES.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Coach</span>
                      <select className="input" name="coach_id" defaultValue={coachOptions.length === 1 ? coachOptions[0].id : ""}>
                        <option value="">Any</option>
                        {coachOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>From</span>
                      <input className="input" type="time" name="start_time" defaultValue="12:00" required />
                    </label>
                    <label className="field">
                      <span>Until</span>
                      <input className="input" type="time" name="end_time" defaultValue="13:00" required />
                    </label>
                  </div>
                  <SubmitButton size="small" icon="plus">Add to weekly schedule</SubmitButton>
                </form>
              ) : null}
            </div>
          </Card>
          <Card title="Profile" padded>
            <form action={updateStudent} className="stack">
              <input type="hidden" name="id" value={student.id} />
              <StudentFields student={student} />
              <SubmitButton variant="primary">Save changes</SubmitButton>
            </form>
          </Card>
          <Card padded>
            <form action={setStudentArchived} className="row between wrap">
              <input type="hidden" name="id" value={student.id} />
              <input type="hidden" name="archived" value={student.is_archived ? "0" : "1"} />
              <span className="small muted">
                {student.is_archived ? "This student is hidden from search." : "Archive to hide from search. History is kept."}
              </span>
              <SubmitButton size="small" variant={student.is_archived ? undefined : "danger"}>
                {student.is_archived ? "Restore" : "Archive"}
              </SubmitButton>
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
