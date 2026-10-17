import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { todayInZone } from "@/lib/time";
import { monthLabel, shiftMonth, type RequestEntry } from "@/lib/regular";
import { ButtonLink, EmptyState, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { MonthlySchedules, type MonthlyRecord, type MonthlySlot, type MonthlyStudent } from "@/components/monthly-schedules";
import { detectWeeklySchedules } from "./actions";

export const metadata: Metadata = { title: "Monthly schedules" };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function RegularsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const today = todayInZone(org.timezone);
  const thisMonth = today.slice(0, 7);
  const requested = one(params.month);
  const month = /^\d{4}-\d{2}$/.test(requested) ? requested : shiftMonth(thisMonth, 1);

  const [coachesRes, venuesRes, studentsRes, slotsRes] = await Promise.all([
    supabase.from("coaches").select("id, full_name").eq("org_id", org.id).eq("is_active", true).order("full_name"),
    supabase.from("venues").select("id, name").eq("org_id", org.id).eq("is_active", true).order("name"),
    supabase
      .from("students")
      .select("id, full_name, phone")
      .eq("org_id", org.id)
      .eq("is_regular", true)
      .eq("is_archived", false)
      .order("full_name")
      .limit(2000),
    supabase.from("regular_slots").select("id, student_id, coach_id, weekday, start_time, end_time").eq("org_id", org.id).limit(5000)
  ]);

  const coaches = (coachesRes.data ?? []) as { id: string; full_name: string }[];
  const venues = (venuesRes.data ?? []) as { id: string; name: string }[];
  const rawSlots = (slotsRes.data ?? []) as { id: string; student_id: string; coach_id: string | null; weekday: number; start_time: string; end_time: string }[];
  const slotCoaches = Array.from(new Set(rawSlots.map((s) => s.coach_id).filter(Boolean))) as string[];
  const requestedCoach = one(params.coach);
  const coachId =
    requestedCoach && coaches.some((c) => c.id === requestedCoach)
      ? requestedCoach
      : coaches.find((c) => slotCoaches.includes(c.id))?.id ?? coaches[0]?.id ?? "";

  let records: MonthlyRecord[] = [];
  let needsUpdate = Boolean(slotsRes.error || studentsRes.error);
  if (!needsUpdate) {
    let query = supabase
      .from("monthly_confirmations")
      .select("id, student_id, status, entries, student_note, token, answered_by, sent_at, office_sent_at")
      .eq("org_id", org.id)
      .eq("month", `${month}-01`);
    query = coachId ? query.eq("coach_id", coachId) : query.is("coach_id", null);
    const { data, error } = await query;
    if (error) needsUpdate = true;
    records = ((data ?? []) as {
      id: string;
      student_id: string;
      status: MonthlyRecord["status"];
      entries: RequestEntry[];
      student_note: string | null;
      token: string;
      answered_by: string | null;
      sent_at: string;
      office_sent_at: string | null;
    }[]).map((r) => ({
      id: r.id,
      studentId: r.student_id,
      status: r.status,
      entries: r.entries ?? [],
      note: r.student_note,
      token: r.token,
      answeredBy: r.answered_by,
      sentAt: r.sent_at,
      officeSentAt: r.office_sent_at
    }));
  }

  const slots: MonthlySlot[] = rawSlots
    .filter((s) => !s.coach_id || s.coach_id === coachId)
    .map((s) => ({ id: s.id, studentId: s.student_id, weekday: s.weekday, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) }));
  const regulars = (studentsRes.data ?? []) as { id: string; full_name: string; phone: string | null }[];
  const students: MonthlyStudent[] = regulars
    .filter((s) => slots.some((slot) => slot.studentId === s.id) || records.some((r) => r.studentId === s.id))
    .map((s) => ({ id: s.id, name: s.full_name, phone: s.phone }));
  const withoutSchedule = regulars.filter((s) => !rawSlots.some((slot) => slot.student_id === s.id));

  const monthOptions = Array.from({ length: 4 }, (_, i) => shiftMonth(thisMonth, i));
  const link = (m: string, c: string) => `/regulars?month=${m}${c ? `&coach=${c}` : ""}`;

  return (
    <>
      <Flash params={params} />
      <PageHeader
        eyebrow="Regular students"
        title="Monthly schedules"
        subtitle="Send each student their schedule for the month. Those who confirm go straight into the message for the office."
      />

      <section className="card card-pad stack" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          {monthOptions.map((m) => (
            <Link key={m} href={link(m, coachId)} className={`btn small ${m === month ? "primary" : "ghost"}`}>
              {monthLabel(m)}
            </Link>
          ))}
        </div>
        {coaches.length > 1 ? (
          <div className="row wrap" style={{ gap: 8 }}>
            {coaches.map((c) => (
              <Link key={c.id} href={link(month, c.id)} className={`btn small ${coachId === c.id ? "primary" : "ghost"}`}>
                Coach {c.full_name}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {needsUpdate ? (
        <div className="card">
          <EmptyState
            icon="alert"
            title="One-time database update needed"
            body="In Supabase → SQL Editor, run the migration files you haven't run yet, up to 0011_monthly_confirmations.sql, then reload this page."
          />
        </div>
      ) : (
        <MonthlySchedules
          key={`${month}-${coachId}`}
          month={month}
          coachId={coachId}
          venues={venues}
          students={students}
          slots={slots}
          records={records}
          officePhone={org.office_phone}
        />
      )}

      {!needsUpdate ? (
        <section className="card card-pad stack" style={{ marginTop: 16 }}>
          <div className="card-title">Weekly schedules</div>
          <p className="small muted" style={{ margin: 0 }}>
            Importing the office sheet saves each student's weekly days and times automatically. You can also edit them on the student's page.
          </p>
          {withoutSchedule.length ? (
            <div className="small">
              <span className="muted">Regular students with no weekly schedule: </span>
              {withoutSchedule.slice(0, 40).map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/students/${s.id}`}>{s.full_name}</Link>
                </span>
              ))}
              {withoutSchedule.length > 40 ? ` and ${withoutSchedule.length - 40} more` : ""}
            </div>
          ) : null}
          <div className="row wrap">
            <ButtonLink href="/import" icon="upload" size="small">
              Import the office's PDF
            </ButtonLink>
            <form action={detectWeeklySchedules} className="row wrap">
              <input type="hidden" name="return_to" value={link(month, coachId)} />
              <input type="hidden" name="source_month" value={thisMonth} />
              <SubmitButton size="small" variant="ghost" icon="refresh" pendingText="Finding…">
                Fill missing weekly schedules from {monthLabel(thisMonth)}
              </SubmitButton>
            </form>
          </div>
        </section>
      ) : null}
    </>
  );
}
