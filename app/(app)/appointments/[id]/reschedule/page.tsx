import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { loadReferenceData } from "@/lib/data";
import { AppointmentForm } from "@/components/appointment-form";
import { PageHeader, StatusBadge } from "@/components/ui";
import { APPOINTMENT_SELECT, type AppointmentWithRelations } from "@/lib/types";
import { formatDate, formatTimeRange, minutesBetween } from "@/lib/format";
import { utcToZonedInputs } from "@/lib/time";

export const metadata: Metadata = { title: "Reschedule" };

export default async function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const { data } = await supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  const appt = data as unknown as AppointmentWithRelations;
  if (["cancelled", "rescheduled", "completed", "no_show"].includes(appt.status)) {
    redirect(`/appointments/${id}?error=${encodeURIComponent("This appointment can no longer be rescheduled.")}`);
  }
  const ref = await loadReferenceData(supabase, org.id);
  const local = utcToZonedInputs(appt.starts_at, org.timezone);

  return (
    <>
      <PageHeader
        eyebrow={`Reschedule · ${appt.reference}`}
        title={appt.student?.full_name ?? "Reschedule"}
        subtitle={
          <span className="row wrap">
            Currently {formatDate(appt.starts_at, org.timezone, "short")}, {formatTimeRange(appt.starts_at, appt.ends_at, org.timezone)} with{" "}
            {appt.coach?.full_name} <StatusBadge status={appt.status} />
          </span>
        }
      />
      {appt.student_note && appt.status === "reschedule_requested" ? (
        <div className="notice info">
          <div>
            <strong>Student's preferred times:</strong> {appt.student_note}
          </div>
        </div>
      ) : null}
      <AppointmentForm
        mode="reschedule"
        appointmentId={appt.id}
        version={appt.version}
        coaches={ref.coaches}
        venues={ref.venues}
        courts={ref.courts}
        sessionTypes={ref.sessionTypes}
        agents={ref.agents}
        stepMinutes={org.slot_step_minutes}
        defaults={{
          coachId: appt.coach_id,
          venueId: appt.venue_id,
          courtId: appt.court_id ?? undefined,
          date: local.date,
          time: local.time,
          duration: minutesBetween(appt.starts_at, appt.ends_at)
        }}
      />
    </>
  );
}
