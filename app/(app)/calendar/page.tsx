import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isStaff } from "@/lib/session";
import { groupShared } from "@/lib/shared-lessons";
import { APPOINTMENT_SELECT, type AppointmentWithRelations, type Coach, type Venue } from "@/lib/types";
import { formatTime, STATUS_META } from "@/lib/format";
import { addDays, isValidDateInput, startOfWeek, todayInZone, utcToZonedInputs, zonedToUtc } from "@/lib/time";
import { PageHeader, one } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DayStrip } from "@/components/day-strip";

export const metadata: Metadata = { title: "Calendar" };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership } = await requireSession();
  const tz = org.timezone;
  const staff = isStaff(membership.role);
  const today = todayInZone(tz);
  const requested = one(params.week);
  const weekStart = startOfWeek(isValidDateInput(requested) ? requested : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const coachFilter = one(params.coach);
  const venueFilter = one(params.venue);
  const showCancelled = one(params.cancelled) === "1";

  let query = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("org_id", org.id)
    .gte("starts_at", zonedToUtc(weekStart, "00:00", tz).toISOString())
    .lt("starts_at", zonedToUtc(addDays(weekStart, 7), "00:00", tz).toISOString())
    .neq("status", "rescheduled")
    .order("starts_at");
  if (!showCancelled) query = query.not("status", "in", "(cancelled,declined,not_approved)");
  if (coachFilter) query = query.eq("coach_id", coachFilter);
  if (venueFilter) query = query.eq("venue_id", venueFilter);

  const [{ data }, coachesRes, venuesRes] = await Promise.all([
    query,
    supabase.from("coaches").select("id, full_name, color, is_active").eq("org_id", org.id).order("full_name"),
    supabase.from("venues").select("id, name").eq("org_id", org.id).order("name")
  ]);
  const appointments = (data ?? []) as unknown as AppointmentWithRelations[];
  const coaches = (coachesRes.data ?? []) as Pick<Coach, "id" | "full_name" | "color" | "is_active">[];
  const venues = (venuesRes.data ?? []) as Pick<Venue, "id" | "name">[];

  const nowMs = Date.now();
  const isPast = (a: { ends_at: string }) => new Date(a.ends_at).getTime() < nowMs;
  const byDay = new Map<string, AppointmentWithRelations[]>();
  for (const a of appointments) {
    const key = utcToZonedInputs(a.starts_at, tz).date;
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }

  const link = (overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { week: weekStart, coach: coachFilter, venue: venueFilter, cancelled: showCancelled ? "1" : "", ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    return `/calendar?${p.toString()}`;
  };

  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${weekStart}T12:00:00Z`)
  );

  return (
    <>
      <PageHeader
        title={monthLabel}
        subtitle={`Week of ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${weekStart}T12:00:00Z`))} · ${appointments.length} session${appointments.length === 1 ? "" : "s"}`}
        actions={
          <>
            {staff ? (
              <Link className="btn small" href="/import">
                <Icon name="upload" size={15} /> Import sheet
              </Link>
            ) : null}
            <details className="disclosure picker">
              <summary className="btn small">
                <Icon name="download" size={15} /> Spreadsheet
              </summary>
              <div className="picker-menu" style={{ left: "auto", right: 0, width: 220 }}>
                {[1, 4].map((n) => (
                  <a
                    key={n}
                    className="picker-option"
                    href={`/api/calendar/export?${new URLSearchParams({
                      week: weekStart,
                      weeks: String(n),
                      ...(coachFilter ? { coach: coachFilter } : {}),
                      ...(venueFilter ? { venue: venueFilter } : {}),
                      ...(showCancelled ? { cancelled: "1" } : {})
                    }).toString()}`}
                  >
                    <Icon name="download" size={15} />
                    {n === 1 ? "This week" : "Next 4 weeks"}
                  </a>
                ))}
              </div>
            </details>
            <div className="week-nav">
              <Link className="btn small" href={link({ week: addDays(weekStart, -7) })} aria-label="Previous week">
                <Icon name="chevronLeft" size={16} />
              </Link>
              <Link className="btn small week-nav-today" href={link({ week: today })}>
                This week
              </Link>
              <Link className="btn small" href={link({ week: addDays(weekStart, 7) })} aria-label="Next week">
                <Icon name="chevronRight" size={16} />
              </Link>
            </div>
          </>
        }
      />

      <section className="card">
        <form className="toolbar" method="get">
          <input type="hidden" name="week" value={weekStart} />
          {coaches.length > 1 && membership.role !== "coach" ? (
            <label className="field">
              <span>Coach</span>
              <select className="input" name="coach" defaultValue={coachFilter}>
                <option value="">All coaches</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {venues.length > 1 ? (
            <label className="field">
              <span>Venue</span>
              <select className="input" name="venue" defaultValue={venueFilter}>
                <option value="">All venues</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="check small" style={{ paddingBottom: 10 }}>
            <input type="checkbox" name="cancelled" value="1" defaultChecked={showCancelled} /> Show cancelled
          </label>
          <button className="btn small" type="submit">
            Apply
          </button>
          <div className="row wrap" style={{ marginLeft: "auto", gap: 12 }}>
            {coaches
              .filter((c) => c.is_active)
              .slice(0, 8)
              .map((c) => (
                <span key={c.id} className="row small" style={{ gap: 6 }}>
                  <span className="coach-dot" style={{ background: c.color }} />
                  {c.full_name}
                </span>
              ))}
          </div>
        </form>

        <DayStrip
          days={days.map((day, index) => ({
            date: day,
            weekday: DAY_NAMES[index],
            dayNumber: Number(day.slice(8, 10)),
            count: byDay.get(day)?.length ?? 0,
            isToday: day === today,
            isPast: day < today
          }))}
        />
        <div className="week-scroll">
          <div className="week">
            {days.map((day, index) => {
              const items = byDay.get(day) ?? [];
              const dayNumber = Number(day.slice(8, 10));
              return (
                <div key={day} className={`week-day ${day === today ? "today" : ""} ${day < today ? "past-day" : ""}`} data-today={day === today ? "1" : undefined}>
                  <div className="week-day-head">
                    <strong>{dayNumber}</strong>
                    <span className="small muted">
                      {DAY_NAMES[index]} · {new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}
                    </span>
                    {items.length ? <span className="badge plain tone-slate" style={{ height: 20, fontSize: 11 }}>{items.length}</span> : null}
                    {staff && day >= today ? (
                      <Link href={`/appointments/new?date=${day}${coachFilter ? `&coach=${coachFilter}` : ""}`} className="btn ghost small" style={{ marginLeft: "auto", height: 24, padding: "0 6px" }} title="Book on this day">
                        <Icon name="plus" size={14} />
                      </Link>
                    ) : null}
                  </div>
                  {items.length === 0 ? <span className="small faint" style={{ padding: "0 4px" }}>—</span> : null}
                  {groupShared(items).map((group) => {
                    const a = group[0];
                    const dim = a.status === "cancelled" || a.status === "declined" || a.status === "not_approved";
                    if (group.length > 1) {
                      return (
                        <div key={a.id} className="cal-shared">
                          <div className="cal-shared-head">
                            <Icon name="users" size={12} /> Same time · {group.length} students
                          </div>
                          <div className="cal-shared-boxes">
                            {group.map((g) => {
                              const gDim = g.status === "cancelled" || g.status === "declined" || g.status === "not_approved";
                              return (
                                <Link
                                  key={g.id}
                                  href={`/appointments/${g.id}`}
                                  className={`cal-item ${gDim ? "dim" : ""} ${isPast(g) ? "past" : ""}`}
                                  style={{ borderLeftColor: g.coach?.color ?? "var(--court-2)" }}
                                  title={`${g.student?.full_name} · ${STATUS_META[g.status].label}`}
                                >
                                  <div className="mono" style={{ fontWeight: 650 }}>
                                    {formatTime(g.starts_at, tz)}–{formatTime(g.ends_at, tz)}
                                  </div>
                                  <div className="cal-student">{g.student?.full_name}</div>
                                  <div className="muted">
                                    {g.coach?.full_name}
                                    {g.court ? ` · ${g.court.name}` : ""}
                                  </div>
                                  <div style={{ marginTop: 4 }}>
                                    <span className={`badge tone-${STATUS_META[g.status].tone}`} style={{ height: 18, fontSize: 10.5, padding: "0 6px" }}>
                                      {STATUS_META[g.status].label}
                                    </span>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={a.id}
                        href={`/appointments/${a.id}`}
                        className={`cal-item ${dim ? "dim" : ""} ${isPast(a) ? "past" : ""}`}
                        style={{ borderLeftColor: a.coach?.color ?? "var(--court-2)" }}
                        title={STATUS_META[a.status].label}
                      >
                        <div className="mono" style={{ fontWeight: 650 }}>
                          {formatTime(a.starts_at, tz)}–{formatTime(a.ends_at, tz)}
                        </div>
                        <div className="cal-student">
                          {a.student?.full_name}
                        </div>
                        <div className="muted">
                          {a.coach?.full_name}
                          {a.court ? ` · ${a.court.name}` : ""}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <span className={`badge tone-${STATUS_META[a.status].tone}`} style={{ height: 18, fontSize: 10.5, padding: "0 6px" }}>
                            {STATUS_META[a.status].label}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
