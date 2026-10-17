import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { todayInZone } from "@/lib/time";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { SheetImport } from "@/components/sheet-import";

export const metadata: Metadata = { title: "Import office sheet" };

export default async function ImportPage() {
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const [coachesRes, venuesRes, studentsRes] = await Promise.all([
    supabase.from("coaches").select("id, full_name").eq("org_id", org.id).eq("is_active", true).order("full_name"),
    supabase.from("venues").select("id, name").eq("org_id", org.id).eq("is_active", true).order("name"),
    supabase.from("students").select("full_name").eq("org_id", org.id).limit(20000)
  ]);
  const coaches = (coachesRes.data ?? []) as { id: string; full_name: string }[];
  const venues = (venuesRes.data ?? []) as { id: string; name: string }[];
  const studentNames = ((studentsRes.data ?? []) as { full_name: string }[]).map((s) => s.full_name);

  return (
    <>
      <PageHeader
        eyebrow="Regular students"
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
          studentNames={studentNames}
          defaultDaysBefore={org.confirm_days_before ?? 2}
          today={todayInZone(org.timezone)}
        />
      )}
    </>
  );
}
