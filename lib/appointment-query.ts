import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APPOINTMENT_SELECT } from "@/lib/types";
import { addDays, isValidDateInput, zonedToUtc } from "@/lib/time";

export const VIEWS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "to_contact", label: "To contact" },
  { key: "awaiting", label: "Awaiting reply" },
  { key: "reschedule", label: "New time requested" },
  { key: "office", label: "Waiting for office" },
  { key: "tell_student", label: "Tell student result" },
  { key: "confirmed", label: "Confirmed" },
  { key: "to_close", label: "To close" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled & not going ahead" },
  { key: "all", label: "All" }
] as const;

export type ViewKey = (typeof VIEWS)[number]["key"];

export interface AppointmentFilters {
  view: ViewKey;
  q: string;
  coach: string;
  venue: string;
  status: string;
  from: string;
  to: string;
  sort: "asc" | "desc";
  page: number;
}

export function parseFilters(params: Record<string, string | string[] | undefined>): AppointmentFilters {
  const get = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value ?? "").trim();
  };
  const view = (VIEWS.some((v) => v.key === get("view")) ? get("view") : "upcoming") as ViewKey;
  const defaultSort = view === "past" || view === "cancelled" ? "desc" : "asc";
  return {
    view,
    q: get("q").slice(0, 80),
    coach: get("coach"),
    venue: get("venue"),
    status: get("status"),
    from: isValidDateInput(get("from")) ? get("from") : "",
    to: isValidDateInput(get("to")) ? get("to") : "",
    sort: get("sort") === "desc" ? "desc" : get("sort") === "asc" ? "asc" : defaultSort,
    page: Math.max(1, Number(get("page")) || 1)
  };
}

export function filtersToQuery(filters: Partial<AppointmentFilters>, overrides: Partial<AppointmentFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "" || value === null) continue;
    if (key === "page" && Number(value) <= 1) continue;
    if (key === "view" && value === "upcoming") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export async function queryAppointments(
  supabase: SupabaseClient,
  orgId: string,
  timeZone: string,
  filters: AppointmentFilters,
  options: { pageSize?: number; all?: boolean } = {}
) {
  const pageSize = options.pageSize ?? 50;
  const now = new Date().toISOString();
  let query = supabase.from("appointments").select(APPOINTMENT_SELECT, { count: "exact" }).eq("org_id", orgId);

  switch (filters.view) {
    case "upcoming":
      query = query.gte("ends_at", now).not("status", "in", "(cancelled,rescheduled,declined,not_approved)");
      break;
    case "to_contact":
      query = query.gte("starts_at", now).eq("status", "scheduled");
      break;
    case "awaiting":
      query = query.gte("starts_at", now).eq("status", "awaiting_response");
      break;
    case "reschedule":
      query = query.eq("status", "reschedule_requested");
      break;
    case "office":
      query = query.gte("starts_at", now).eq("status", "pending_approval");
      break;
    case "tell_student":
      query = query.gte("starts_at", now).in("status", ["confirmed", "not_approved"]).is("student_informed_at", null);
      break;
    case "confirmed":
      query = query.gte("starts_at", now).eq("status", "confirmed");
      break;
    case "to_close":
      query = query.lt("ends_at", now).in("status", ["scheduled", "awaiting_response", "pending_approval", "confirmed"]);
      break;
    case "past":
      query = query.lt("starts_at", now).not("status", "eq", "rescheduled");
      break;
    case "cancelled":
      query = query.in("status", ["cancelled", "declined", "not_approved", "rescheduled"]);
      break;
    default:
      break;
  }

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.coach) query = query.eq("coach_id", filters.coach);
  if (filters.venue) query = query.eq("venue_id", filters.venue);
  if (filters.from) query = query.gte("starts_at", zonedToUtc(filters.from, "00:00", timeZone).toISOString());
  if (filters.to) query = query.lt("starts_at", zonedToUtc(addDays(filters.to, 1), "00:00", timeZone).toISOString());

  if (filters.q) {
    const safe = filters.q.replace(/[%,()*\\]/g, " ").trim();
    const digits = filters.q.replace(/\D/g, "").replace(/^0+/, "");
    const studentFilters = [`full_name.ilike.%${safe}%`, `email.ilike.%${safe}%`, `guardian_name.ilike.%${safe}%`];
    if (digits.length >= 3) studentFilters.push(`phone.ilike.%${digits}%`);
    const { data: students } = await supabase
      .from("students")
      .select("id")
      .eq("org_id", orgId)
      .or(studentFilters.join(","))
      .limit(300);
    const ids = (students ?? []).map((s: { id: string }) => s.id);
    const parts = [`reference.ilike.%${safe}%`];
    if (ids.length > 0) parts.push(`student_id.in.(${ids.join(",")})`);
    query = query.or(parts.join(","));
  }

  query = query.order("starts_at", { ascending: filters.sort === "asc" });
  if (!options.all) {
    const from = (filters.page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
  } else {
    query = query.limit(5000);
  }

  return query;
}
