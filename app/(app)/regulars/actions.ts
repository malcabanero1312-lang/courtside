"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { logError } from "@/lib/errors";
import { utcToZonedInputs, zonedToUtc } from "@/lib/time";
import { shiftMonth, weekdayOfDate } from "@/lib/regular";

const MONTH = /^\d{4}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{24,128}$/;
const NEEDS_UPDATE = "The database needs an update. In Supabase → SQL Editor, run the migration files up to 0012_monthly_dates_and_venue_colors.sql.";

export interface ActionResult {
  ok: boolean;
  error?: string;
  token?: string;
  created?: number;
}

export interface SendMonthlyInput {
  month: string;
  coachId: string;
  venueId: string;
  studentId: string;
  token: string;
  entries: { date: string; start: string; end: string }[];
}

export async function sendMonthly(input: SendMonthlyInput): Promise<ActionResult> {
  const { supabase, org, user, membership } = await requireSession(["admin", "agent"]);
  if (!MONTH.test(input.month)) return { ok: false, error: "Choose the month." };
  if (!input.venueId) return { ok: false, error: "Choose the venue first." };
  const entries = input.entries
    .filter((e) => DATE.test(e.date) && e.date.startsWith(input.month) && TIME.test(e.start) && TIME.test(e.end) && e.end > e.start)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  if (!entries.length) return { ok: false, error: "Add at least one date." };
  const coachId = input.coachId || null;
  const monthDate = `${input.month}-01`;

  let query = supabase.from("monthly_confirmations").select("id, token").eq("student_id", input.studentId).eq("month", monthDate);
  query = coachId ? query.eq("coach_id", coachId) : query.is("coach_id", null);
  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) {
    logError("monthly-find", findError);
    return { ok: false, error: NEEDS_UPDATE };
  }

  if (existing) {
    await supabase.rpc("staff_reset_monthly", { p_id: existing.id });
    const { error } = await supabase
      .from("monthly_confirmations")
      .update({
        entries,
        requested_entries: entries,
        venue_id: input.venueId,
        status: "sent",
        student_note: null,
        answered_by: null,
        responded_at: null,
        office_sent_at: null,
        sent_at: new Date().toISOString(),
        assigned_agent_id: membership.id
      })
      .eq("id", existing.id);
    if (error) {
      logError("monthly-update", error);
      return { ok: false, error: ["PGRST204", "42703"].includes(error.code ?? "") ? NEEDS_UPDATE : "Couldn't save. Try again." };
    }
    revalidatePath("/regulars");
    return { ok: true, token: existing.token as string };
  }

  if (!TOKEN.test(input.token)) return { ok: false, error: "Couldn't create the link. Reload the page and try again." };
  const { error } = await supabase.from("monthly_confirmations").insert({
    org_id: org.id,
    student_id: input.studentId,
    coach_id: coachId,
    venue_id: input.venueId,
    month: monthDate,
    token: input.token,
    entries,
    requested_entries: entries,
    status: "sent",
    assigned_agent_id: membership.id,
    created_by: user.id
  });
  if (error) {
    logError("monthly-insert", error);
    return { ok: false, error: ["42P01", "PGRST204", "42703"].includes(error.code ?? "") ? NEEDS_UPDATE : "Couldn't save. Try again." };
  }
  revalidatePath("/regulars");
  return { ok: true, token: input.token };
}

export async function confirmMonthlyByStaff(id: string): Promise<ActionResult> {
  const { supabase } = await requireSession(["admin", "agent"]);
  const { data, error } = await supabase.rpc("staff_confirm_monthly", { p_id: id });
  if (error) {
    logError("monthly-staff-confirm", error);
    return { ok: false, error: "Couldn't mark as confirmed." };
  }
  revalidatePath("/regulars");
  revalidatePath("/calendar");
  return { ok: true, created: Number(data ?? 0) };
}

export async function markOfficeSent(ids: string[]): Promise<ActionResult> {
  const { supabase } = await requireSession(["admin", "agent"]);
  const list = ids.filter((id) => typeof id === "string").slice(0, 1000);
  if (!list.length) return { ok: true };
  const now = new Date().toISOString();
  const { error } = await supabase.from("monthly_confirmations").update({ office_sent_at: now }).in("id", list);
  if (error) {
    logError("monthly-office-sent", error);
    return { ok: false, error: "Couldn't save." };
  }
  await supabase
    .from("appointments")
    .update({ office_contacted_at: now })
    .in("monthly_id", list)
    .eq("status", "pending_approval");
  revalidatePath("/regulars");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function detectWeeklySchedules(formData: FormData) {
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const month = String(formData.get("source_month") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/regulars");
  const back = (kind: "notice" | "error", message: string): never =>
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
  if (!MONTH.test(month)) back("error", "Choose a month.");

  const tz = org.timezone;
  const from = zonedToUtc(`${month}-01`, "00:00", tz).toISOString();
  const to = zonedToUtc(`${shiftMonth(month, 1)}-01`, "00:00", tz).toISOString();

  const [{ data: appts, error }, { data: existingSlots }] = await Promise.all([
    supabase
      .from("appointments")
      .select("student_id, coach_id, starts_at, ends_at, import_batch, student:students(is_regular, is_archived)")
      .eq("org_id", org.id)
      .gte("starts_at", from)
      .lt("starts_at", to)
      .not("status", "in", "(cancelled,declined,not_approved,rescheduled)")
      .limit(5000),
    supabase.from("regular_slots").select("student_id").eq("org_id", org.id)
  ]);
  if (error) back("error", "The database needs update 0010 first.");

  const hasSlots = new Set(((existingSlots ?? []) as { student_id: string }[]).map((s) => s.student_id));
  const counts = new Map<string, { student_id: string; coach_id: string; weekday: number; start: string; end: string; n: number }>();
  for (const a of (appts ?? []) as unknown as {
    student_id: string;
    coach_id: string;
    starts_at: string;
    ends_at: string;
    import_batch: string | null;
    student: { is_regular: boolean; is_archived: boolean } | null;
  }[]) {
    if (hasSlots.has(a.student_id) || a.student?.is_archived) continue;
    if (!a.student?.is_regular && !a.import_batch) continue;
    const s = utcToZonedInputs(a.starts_at, tz);
    const e = utcToZonedInputs(a.ends_at, tz);
    const weekday = weekdayOfDate(s.date);
    const key = `${a.student_id}|${a.coach_id}|${weekday}|${s.time}|${e.time}`;
    const entry = counts.get(key) ?? { student_id: a.student_id, coach_id: a.coach_id, weekday, start: s.time, end: e.time, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }

  const slots = Array.from(counts.values())
    .filter((c) => c.n >= 2 && c.end > c.start)
    .map((c) => ({ org_id: org.id, student_id: c.student_id, coach_id: c.coach_id, weekday: c.weekday, start_time: c.start, end_time: c.end }));
  if (!slots.length) back("notice", "No repeating weekly bookings found in that month for students without a schedule.");

  const { error: insertError } = await supabase.from("regular_slots").insert(slots);
  if (insertError) {
    logError("detect-slots", insertError);
    back("error", "Couldn't save the weekly schedules.");
  }
  const students = Array.from(new Set(slots.map((s) => s.student_id)));
  await supabase.from("students").update({ is_regular: true }).in("id", students).eq("is_regular", false);
  revalidatePath("/regulars");
  back("notice", `Set up ${slots.length} weekly time${slots.length === 1 ? "" : "s"} for ${students.length} student${students.length === 1 ? "" : "s"}.`);
}
