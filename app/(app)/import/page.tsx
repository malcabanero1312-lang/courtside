import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { todayInZone, utcToZonedInputs } from "@/lib/time";
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
  const { data: pendingRows } = await supabase
    .from("appointments")
    .select("id, student_id, coach_id, starts_at, ends_at, student:students(full_name, phone)")
    .eq("org_id", org.id)
    .eq("status", "pending_approval")
    .gte("starts_at", new Date(Date.now() - 62 * 86400000).toISOString())
    .order("starts_at")
    .limit(3000);
  const requested: RequestedItem[] = (
    (pendingRows ?? []) as unknown as {
      id: string;
      student_id: string;
      coach_id: string;
      starts_at: string;
      ends_at: string;
      student: { full_name: string; phone: string | null } | null;
    }[]
  ).map((r) => {
    const start = utcToZonedInputs(r.starts_at, org.timezone);
    const end = utcToZonedInputs(r.ends_at, org.timezone);
    return {
      id: r.id,
      studentId: r.student_id,
      studentName: r.student?.full_name ?? "",
      phone: r.student?.phone ?? null,
      coachId: r.coach_id,
      date: start.date,
      start: start.time,
      end: end.time
    };
  });
  const studentNames = ((studentsRes.data ?? []) as { full_name: string }[]).map((s) => s.full_name);

  return (
    <>
      <PageHeader
        eyebrow="Office sheet"
        title="Import office sheet"
        subtitle="Attach the office's court bookings PDF. Everything on it is saved as confirmed, and each student's weekly schedule is updated."
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
          today={today}
          requested={requested}
        />
      )}
    </>
  );
}
