"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { logError } from "@/lib/errors";
import { utcToZonedInputs, zonedToUtc } from "@/lib/time";
import { shiftMonth, weekdayOfDate } from "@/lib/regular";

export interface SaveRequestInput {
  month: string;
  coachId: string;
  message: string;
  students: { studentId: string; entries: { date: string; start: string; end: string }[] }[];
}

export interface SaveRequestResult {
  ok: boolean;
  error?: string;
  savedAt?: string;
  count?: number;
}

const MONTH = /^\d{4}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveOfficeRequest(input: SaveRequestInput): Promise<SaveRequestResult> {
  const { supabase, org, user } = await requireSession(["admin", "agent"]);
  if (!MONTH.test(input.month)) return { ok: false, error: "Choose the month." };
  const coachId = input.coachId || null;
  const monthDate = `${input.month}-01`;

  const entries = input.students.flatMap((s) =>
    s.entries
      .filter((e) => DATE.test(e.date) && e.date.startsWith(input.month) && TIME.test(e.start) && TIME.test(e.end) && e.end > e.start)
      .map((e) => ({ studentId: s.studentId, ...e }))
  );

  let query = supabase.from("office_requests").select("id").eq("org_id", org.id).eq("month", monthDate);
  query = coachId ? query.eq("coach_id", coachId) : query.is("coach_id", null);
  const { data: found, error: findError } = await query.maybeSingle();
  if (findError) {
    logError("office-request-find", findError);
    return { ok: false, error: "The database needs update 0010. In Supabase → SQL Editor, run supabase/migrations/0010_regular_schedules.sql." };
  }

  const now = new Date().toISOString();
  let requestId = found?.id as string | undefined;
  if (requestId) {
    await supabase.from("office_requests").update({ message: input.message, sent_at: now }).eq("id", requestId);
  } else {
    const { data: created, error } = await supabase
      .from("office_requests")
      .insert({ org_id: org.id, coach_id: coachId, month: monthDate, message: input.message, sent_at: now, created_by: user.id })
      .select("id")
      .single();
    if (error || !created) {
      logError("office-request-create", error);
      return { ok: false, error: "Couldn't save the request. Try again." };
    }
    requestId = created.id as string;
  }

  const { data: settled } = await supabase
    .from("office_request_items")
    .select("student_id, date")
    .eq("request_id", requestId)
    .neq("result", "pending");
  const done = new Set(((settled ?? []) as { student_id: string; date: string }[]).map((i) => `${i.student_id}|${i.date}`));

  await supabase.from("office_request_items").delete().eq("request_id", requestId).eq("result", "pending");
  const rows = entries
    .filter((e) => !done.has(`${e.studentId}|${e.date}`))
    .map((e) => ({
      org_id: org.id,
      request_id: requestId,
      student_id: e.studentId,
      coach_id: coachId,
      date: e.date,
      start_time: e.start,
      end_time: e.end
    }));
  if (rows.length) {
    const { error } = await supabase.from("office_request_items").insert(rows);
    if (error) {
      logError("office-request-items", error);
      return { ok: false, error: "Couldn't save the schedule lines. Try again." };
    }
  }

  revalidatePath("/regulars");
  revalidatePath("/import");
  return { ok: true, savedAt: now, count: rows.length };
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
  back("notice", `Set up ${slots.length} weekly time${slots.length === 1 ? "" : "s"} for ${students.length} student${students.length === 1 ? "" : "s"}. Check them below.`);
}
