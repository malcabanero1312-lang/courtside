import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { todayInZone } from "@/lib/time";
import { monthLabel, shiftMonth } from "@/lib/regular";
import { ButtonLink, EmptyState, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { OfficeRequestBuilder, type BuilderSlot, type BuilderStudent, type SavedItem } from "@/components/office-request";
import { detectWeeklySchedules } from "./actions";

export const metadata: Metadata = { title: "Monthly office request" };

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
  const coachId = one(params.coach);

  const [coachesRes, studentsRes, slotsRes] = await Promise.all([
    supabase.from("coaches").select("id, full_name").eq("org_id", org.id).eq("is_active", true).order("full_name"),
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
  const needsUpdate = Boolean(slotsRes.error || studentsRes.error);

  let saved: SavedItem[] = [];
  let savedAt: string | null = null;
  if (!needsUpdate) {
    let reqQuery = supabase.from("office_requests").select("id, sent_at").eq("org_id", org.id).eq("month", `${month}-01`);
    reqQuery = coachId ? reqQuery.eq("coach_id", coachId) : reqQuery.is("coach_id", null);
    const { data: req } = await reqQuery.maybeSingle();
    if (req) {
      savedAt = (req.sent_at as string | null) ?? null;
      const { data: items } = await supabase
        .from("office_request_items")
        .select("student_id, date, start_time, end_time, result")
        .eq("request_id", req.id)
        .order("date");
      saved = ((items ?? []) as { student_id: string; date: string; start_time: string; end_time: string; result: SavedItem["result"] }[]).map((i) => ({
        studentId: i.student_id,
        date: i.date,
        start: i.start_time.slice(0, 5),
        end: i.end_time.slice(0, 5),
        result: i.result
      }));
    }
  }

  const allSlots = ((slotsRes.data ?? []) as { id: string; student_id: string; coach_id: string | null; weekday: number; start_time: string; end_time: string }[])
    .filter((s) => !coachId || !s.coach_id || s.coach_id === coachId)
    .map(
      (s): BuilderSlot => ({
        id: s.id,
        studentId: s.student_id,
        weekday: s.weekday,
        start: s.start_time.slice(0, 5),
        end: s.end_time.slice(0, 5)
      })
    );
  const regulars = (studentsRes.data ?? []) as { id: string; full_name: string; phone: string | null }[];
  const savedStudents = new Set(saved.map((s) => s.studentId));
  const students: BuilderStudent[] = regulars
    .filter((s) => allSlots.some((slot) => slot.studentId === s.id) || savedStudents.has(s.id))
    .map((s) => ({ id: s.id, name: s.full_name, phone: s.phone }));
  const anySlots = ((slotsRes.data ?? []) as { student_id: string }[]).map((s) => s.student_id);
  const withoutSchedule = regulars.filter((s) => !anySlots.includes(s.id));

  const monthOptions = Array.from({ length: 5 }, (_, i) => shiftMonth(thisMonth, i - 1));
  const link = (m: string, c: string) => `/regulars?month=${m}${c ? `&coach=${c}` : ""}`;

  return (
    <>
      <Flash params={params} />
      <PageHeader
        eyebrow="Regular students"
        title="Monthly office request"
        subtitle="Tick who's continuing, adjust any changes, then send the office one short message. When their sheet comes back, import it and Courtside compares."
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
            <Link href={link(month, "")} className={`btn small ${!coachId ? "primary" : "ghost"}`}>
              All coaches
            </Link>
            {coaches.map((c) => (
              <Link key={c.id} href={link(month, c.id)} className={`btn small ${coachId === c.id ? "primary" : "ghost"}`}>
                {c.full_name}
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
            body="In Supabase → SQL Editor, run supabase/migrations/0010_regular_schedules.sql (and 0008 if you haven't), then reload this page."
          />
        </div>
      ) : (
        <OfficeRequestBuilder
          key={`${month}-${coachId}`}
          month={month}
          coachId={coachId}
          students={students}
          slots={allSlots}
          saved={saved}
          savedAt={savedAt}
          officePhone={org.office_phone}
          timezone={org.timezone}
        />
      )}

      {!needsUpdate ? (
        <section className="card card-pad stack" style={{ marginTop: 16 }}>
          <div className="card-title">Set up weekly schedules</div>
          <p className="small muted" style={{ margin: 0 }}>
            Each regular student needs their fixed days and times. Add them on the student's page, or let Courtside find repeating bookings
            (like the office sheet you imported) and fill them in.
          </p>
          <form action={detectWeeklySchedules} className="row wrap">
            <input type="hidden" name="return_to" value={link(month, coachId)} />
            <select className="input" name="source_month" defaultValue={thisMonth} style={{ width: 180 }}>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  From {monthLabel(m)}
                </option>
              ))}
            </select>
            <SubmitButton icon="refresh" pendingText="Finding…">
              Find weekly schedules from bookings
            </SubmitButton>
          </form>
          {withoutSchedule.length ? (
            <div className="small">
              <span className="muted">Regular students with no weekly schedule yet: </span>
              {withoutSchedule.slice(0, 40).map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/students/${s.id}`}>{s.full_name}</Link>
                </span>
              ))}
              {withoutSchedule.length > 40 ? ` and ${withoutSchedule.length - 40} more` : ""}
            </div>
          ) : null}
          <div className="row">
            <ButtonLink href="/import" icon="upload" size="small">
              Import the office's reply (PDF)
            </ButtonLink>
          </div>
        </section>
      ) : null}
    </>
  );
}
