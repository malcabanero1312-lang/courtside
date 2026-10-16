import { durationLabel, firstName, formatDate, formatTime, minutesBetween, statusLabel } from "@/lib/format";
import type { AppointmentWithRelations, Organization } from "@/lib/types";

export const PLACEHOLDERS: { key: string; description: string }[] = [
  { key: "student_first_name", description: "Student's first name" },
  { key: "student_name", description: "Student's full name" },
  { key: "date", description: "Session date, e.g. Tuesday 20 October 2026" },
  { key: "time", description: "Start time, e.g. 3:00 PM" },
  { key: "end_time", description: "End time" },
  { key: "duration", description: "Length, e.g. 1 hr" },
  { key: "coach", description: "Coach name" },
  { key: "venue", description: "Venue name" },
  { key: "venue_address", description: "Venue address" },
  { key: "court_line", description: "“, Court 1” when a court is set, otherwise empty" },
  { key: "session_type", description: "Session type, e.g. Private lesson" },
  { key: "reference", description: "Booking reference, e.g. TN-4F2A9C" },
  { key: "response_link", description: "Student's confirm / decline link" },
  { key: "agent_name", description: "Name of the staff member sending" },
  { key: "org_name", description: "Your organization name" },
  { key: "status_label", description: "Current status, e.g. Confirmed" },
  { key: "student_note", description: "Note the student left" },
  { key: "cancellation_reason_line", description: "“Reason: …” when a reason was given" },
  { key: "cancellation_policy", description: "Your cancellation policy text" },
  { key: "appointment_url", description: "Staff link to the appointment" }
];

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildTemplateVars(input: {
  appointment: AppointmentWithRelations;
  org: Pick<Organization, "name" | "timezone" | "cancellation_policy">;
  responseLink?: string | null;
  agentName?: string | null;
  appointmentUrl?: string;
}): Record<string, string> {
  const { appointment: a, org } = input;
  const tz = org.timezone;
  const minutes = minutesBetween(a.starts_at, a.ends_at);
  const label = statusLabel(a.status);
  return {
    student_first_name: firstName(a.student?.full_name) || "there",
    student_name: a.student?.full_name ?? "",
    date: formatDate(a.starts_at, tz, "long"),
    time: formatTime(a.starts_at, tz),
    end_time: formatTime(a.ends_at, tz),
    duration: durationLabel(minutes),
    coach: a.coach?.full_name ?? "",
    venue: a.venue?.name ?? "",
    venue_address: a.venue?.address ?? "",
    court_line: a.court?.name ? `, ${a.court.name}` : "",
    session_type: a.session_type?.name ?? "Tennis session",
    reference: a.reference,
    response_link: input.responseLink ?? "",
    agent_name: input.agentName || a.agent?.full_name || org.name,
    org_name: org.name,
    status_label: label,
    status_label_lower: a.status === "reschedule_requested" ? "asked for a new time" : label.toLowerCase(),
    student_note: a.student_note || "—",
    cancellation_reason_line: a.cancellation_reason ? `Reason: ${a.cancellation_reason}` : "",
    cancellation_policy: org.cancellation_policy ?? "",
    appointment_url: input.appointmentUrl ?? ""
  };
}
