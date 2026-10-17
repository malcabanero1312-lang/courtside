import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { addDays, todayInZone } from "@/lib/time";
import type { RequestedItem } from "@/components/sheet-import";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { SheetImport } from "@/components/sheet-import";

export const metadata: Metadata = { title: "Import office sheet" };

export default async function ImportPage() {
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const [coachesRes, venuesRes, studentsRes, courtsRes] = await Promise.all([
    supabase.from("coaches").select("id, full_name").eq("org_id", org.id).eq("is_active", true).order("full_name"),
    supabase.from("venues").select("id, name").eq("org_id", org.id).eq("is_active", true).order("name"),
    supabase.from("students").select("full_name").eq("org_id", org.id).limit(20000),
    supabase.from("courts").select("*").eq("org_id", org.id)
  ]);
  const coaches = (coachesRes.data ?? []) as { id: string; full_name: string }[];
  const venues = (venuesRes.data ?? []) as { id: string; name: string }[];
  const courts = ((courtsRes.data ?? []) as { venue_id: string; name: string; alt_name?: string | null }[]).map((c) => ({
    venueId: c.venue_id,
    name: c.name,
    altName: c.alt_name ?? null
  }));
  const today = todayInZone(org.timezone);
  const { data: requestRows } = await supabase
    .from("office_request_items")
    .select("id, student_id, coach_id, date, start_time, end_time, student:students(full_name, phone)")
    .eq("org_id", org.id)
    .eq("result", "pending")
    .gte("date", addDays(today, -62))
    .order("date")
    .limit(3000);
  const requested: RequestedItem[] = (
    (requestRows ?? []) as unknown as {
      id: string;
      student_id: string;
      coach_id: string | null;
      date: string;
      start_time: string;
      end_time: string;
      student: { full_name: string; phone: string | null } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.student?.full_name ?? "",
    phone: r.student?.phone ?? null,
    coachId: r.coach_id,
    date: r.date,
    start: r.start_time.slice(0, 5),
    end: r.end_time.slice(0, 5)
  }));
  const studentNames = ((studentsRes.data ?? []) as { full_name: string }[]).map((s) => s.full_name);

  return (
    <>
      <PageHeader
        eyebrow="Office sheet"
        title="Import office sheet"
        subtitle="Attach the monthly court bookings PDF, pick a coach, and create their approved sessions in one go."
      />
      {coaches.length === 0 || venues.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="court"
            title="Add a coach and a venue first"
            body="Imported sessions need a Courtside coach (for example Jeffrie) and the venue whose courts are on the sheet."
            action={
              <div className="row">
                <ButtonLink href="/coaches" variant="primary" icon="plus">
                  Add a coach
                </ButtonLink>
                <ButtonLink href="/venues" icon="plus">
                  Add a venue
                </ButtonLink>
              </div>
            }
          />
        </div>
      ) : (
        <SheetImport
          coaches={coaches}
          venues={venues}
          courts={courts}
          studentNames={studentNames}
          defaultDaysBefore={org.confirm_days_before ?? 2}
          today={today}
          requested={requested}
        />
      )}
    </>
  );
}
