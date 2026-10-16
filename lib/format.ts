import type { AppointmentStatus } from "@/lib/types";

export function formatDate(iso: string, timeZone: string, style: "short" | "long" = "long"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: style === "long" ? "long" : "short",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: style === "long" ? "numeric" : undefined
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function formatTimeRange(startIso: string, endIso: string, timeZone: string): string {
  return `${formatTime(startIso, timeZone)} – ${formatTime(endIso, timeZone)}`;
}

export function formatDateTime(iso: string, timeZone: string): string {
  return `${formatDate(iso, timeZone, "short")}, ${formatTime(iso, timeZone)}`;
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  if (hours) return `${hours} hr`;
  return `${rest} min`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let text: string;
  if (abs < minute) text = "just now";
  else if (abs < hour) text = `${Math.round(abs / minute)} min`;
  else if (abs < day) text = `${Math.round(abs / hour)} hr`;
  else text = `${Math.round(abs / day)} day${Math.round(abs / day) === 1 ? "" : "s"}`;
  if (text === "just now") return text;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

export function initials(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  return `+${digits}`;
}

export const STATUS_META: Record<AppointmentStatus, { label: string; tone: string; hint: string }> = {
  scheduled: { label: "To contact", tone: "slate", hint: "Booked, student not messaged yet" },
  awaiting_response: { label: "Awaiting reply", tone: "amber", hint: "Message sent, waiting for the student" },
  pending_approval: { label: "Waiting for office", tone: "ball", hint: "Student confirmed — the office still needs to approve" },
  confirmed: { label: "Confirmed", tone: "green", hint: "Approved by the office" },
  not_approved: { label: "Not approved", tone: "red", hint: "The office did not approve this booking" },
  reschedule_requested: { label: "Wants new time", tone: "violet", hint: "Student asked for another time" },
  declined: { label: "Declined", tone: "red", hint: "Student declined" },
  cancelled: { label: "Cancelled", tone: "muted", hint: "Cancelled by staff" },
  rescheduled: { label: "Moved", tone: "muted", hint: "Replaced by a new appointment" },
  completed: { label: "Completed", tone: "ink", hint: "Session took place" },
  no_show: { label: "No-show", tone: "red", hint: "Student did not attend" }
};

export const ALL_STATUSES = Object.keys(STATUS_META) as AppointmentStatus[];

export function statusLabel(status: string): string {
  return STATUS_META[status as AppointmentStatus]?.label ?? status;
}

export const TIMEZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "UTC"
];
