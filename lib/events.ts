import { formatDateTime, statusLabel } from "@/lib/format";

export interface AppointmentEvent {
  id: string;
  event_type: string;
  actor_type: "staff" | "student" | "system";
  actor_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export function describeEvent(
  event: AppointmentEvent,
  timeZone: string,
  names: Record<string, string>
): { title: string; detail?: string } {
  const who = event.actor_type === "student" ? "Student" : event.actor_name ?? "System";
  const d = event.details ?? {};
  switch (event.event_type) {
    case "created":
      return { title: `${who} booked the appointment` };
    case "created_by_reschedule":
      return { title: `${who} created this as the new time for a rescheduled session` };
    case "status_changed": {
      const to = String(d.to ?? "");
      const from = String(d.from ?? "");
      if (event.actor_type === "student") {
        const verbs: Record<string, string> = {
          confirmed: "Student confirmed",
          declined: "Student declined",
          reschedule_requested: "Student asked for another time"
        };
        return {
          title: verbs[to] ?? `Student changed the status to ${statusLabel(to)}`,
          detail: d.student_note ? `“${String(d.student_note)}”` : undefined
        };
      }
      if (to === "rescheduled") return { title: `${who} moved this session to a new time` };
      return {
        title: `${who} changed status: ${statusLabel(from)} → ${statusLabel(to)}`,
        detail: d.reason ? `Reason: ${String(d.reason)}` : undefined
      };
    }
    case "details_changed": {
      const parts: string[] = [];
      const time = d.time as { from?: string[]; to?: string[] } | undefined;
      if (time?.from?.[0] && time?.to?.[0]) {
        parts.push(`time ${formatDateTime(time.from[0], timeZone)} → ${formatDateTime(time.to[0], timeZone)}`);
      }
      const coach = d.coach_id as { from?: string; to?: string } | undefined;
      if (coach) parts.push(`coach ${names[coach.from ?? ""] ?? "—"} → ${names[coach.to ?? ""] ?? "—"}`);
      if (d.location) parts.push("venue or court");
      if (d.agent) parts.push("assigned agent");
      if (d.session_type) parts.push("session type");
      if (d.notes) parts.push("notes");
      return { title: `${who} updated ${parts.join(", ") || "details"}` };
    }
    case "whatsapp_opened":
      return { title: `${who} opened WhatsApp with the message` };
    case "whatsapp_marked_sent":
      return { title: `${who} confirmed the WhatsApp message was sent` };
    case "link_copied":
      return { title: `${who} copied the response link` };
    case "link_regenerated":
      return { title: `${who} created a new response link`, detail: "Earlier links stopped working." };
    case "student_note_updated":
      return { title: "Student updated their note", detail: d.student_note ? `“${String(d.student_note)}”` : undefined };
    case "calendar_downloaded":
      return { title: `${who} downloaded the calendar invite` };
    default:
      return { title: event.event_type.replace(/_/g, " ") };
  }
}
