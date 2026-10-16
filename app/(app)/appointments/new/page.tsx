import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { loadReferenceData } from "@/lib/data";
import { AppointmentForm } from "@/components/appointment-form";
import { ButtonLink, EmptyState, PageHeader, one } from "@/components/ui";
import { addDays, todayInZone } from "@/lib/time";

export const metadata: Metadata = { title: "New appointment" };

export default async function NewAppointmentPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership } = await requireSession(["admin", "agent"]);
  const ref = await loadReferenceData(supabase, org.id);

  const studentId = one(params.student);
  let student = null;
  if (studentId) {
    const { data } = await supabase
      .from("students")
      .select("id, full_name, phone, email, guardian_name")
      .eq("id", studentId)
      .maybeSingle();
    student = data;
  }

  const missing: string[] = [];
  if (!ref.coaches.some((c) => c.is_active)) missing.push("a coach");
  if (!ref.venues.some((v) => v.is_active)) missing.push("a venue");

  if (missing.length > 0) {
    return (
      <>
        <PageHeader title="New appointment" />
        <div className="card">
          <EmptyState
            icon="calendar"
            title={`Add ${missing.join(" and ")} first`}
            body="Appointments need a coach and a venue so we can check availability and prevent double bookings."
            action={
              <div className="row">
                {missing.includes("a coach") ? <ButtonLink href="/coaches" variant="primary" icon="plus">Add a coach</ButtonLink> : null}
                {missing.includes("a venue") ? <ButtonLink href="/venues" icon="plus">Add a venue</ButtonLink> : null}
              </div>
            }
          />
        </div>
      </>
    );
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(params.date)) ? one(params.date) : addDays(todayInZone(org.timezone), 1);
  const time = /^\d{2}:\d{2}$/.test(one(params.time)) ? one(params.time) : "16:00";
  const defaultType = ref.sessionTypes.find((t) => t.is_active);

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="New appointment"
        subtitle="Availability is checked as you type. Double bookings are blocked automatically."
      />
      <AppointmentForm
        mode="create"
        coaches={ref.coaches}
        venues={ref.venues}
        courts={ref.courts}
        sessionTypes={ref.sessionTypes}
        agents={ref.agents}
        stepMinutes={org.slot_step_minutes}
        defaults={{
          student,
          coachId: one(params.coach) || undefined,
          venueId: one(params.venue) || undefined,
          sessionTypeId: defaultType?.id,
          date,
          time,
          duration: defaultType?.duration_minutes ?? org.default_duration_minutes,
          agentId: membership.role === "agent" ? membership.id : ""
        }}
      />
    </>
  );
}
