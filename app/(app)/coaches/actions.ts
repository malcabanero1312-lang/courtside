"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { normalizePhone } from "@/lib/whatsapp";
import { isValidDateInput, isValidTimeInput, zonedToUtc } from "@/lib/time";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(path: string, kind: "notice" | "error", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

const EMAIL = /^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/;

function readCoach(formData: FormData, countryCode: string) {
  const email = text(formData, "email").toLowerCase() || null;
  const color = text(formData, "color");
  return {
    values: {
      full_name: text(formData, "full_name"),
      email,
      phone: normalizePhone(text(formData, "phone"), countryCode),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1d5c45",
      specialties: text(formData, "specialties") || null,
      is_active: formData.get("is_active") === null ? true : formData.get("is_active") === "on"
    },
    error: !text(formData, "full_name") ? "Enter the coach's name." : email && !EMAIL.test(email) ? "That email address doesn't look right." : null
  };
}

export async function createCoach(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const { values, error } = readCoach(formData, org.default_country_code);
  if (error) back("/coaches", "error", error);
  const { data, error: dbError } = await supabase
    .from("coaches")
    .insert({ ...values, is_active: true, org_id: org.id })
    .select("id")
    .single();
  if (dbError || !data) back("/coaches", "error", friendlyError(dbError));
  const weekdays = [1, 2, 3, 4, 5, 6];
  await supabase.from("coach_availability").insert(
    weekdays.map((weekday) => ({ org_id: org.id, coach_id: data.id, weekday, start_time: "07:00", end_time: "20:00" }))
  );
  revalidatePath("/coaches");
  back(`/coaches/${data.id}`, "notice", "Coach added with default hours (Mon–Sat, 7 AM–8 PM). Adjust them below.");
}

export async function updateCoach(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const id = text(formData, "id");
  const { values, error } = readCoach(formData, org.default_country_code);
  if (error) back(`/coaches/${id}`, "error", error);
  values.is_active = formData.get("is_active") === "on";
  const { error: dbError } = await supabase.from("coaches").update(values).eq("id", id);
  if (dbError) back(`/coaches/${id}`, "error", friendlyError(dbError));
  revalidatePath("/coaches");
  back(`/coaches/${id}`, "notice", "Coach updated.");
}

export async function saveAvailability(formData: FormData) {
  const { supabase, org } = await requireSession(["admin", "coach"]);
  const coachId = text(formData, "coach_id");
  const path = `/coaches/${coachId}`;

  let days: { weekday: number; on: boolean; start: string; end: string; breaks: { start: string; end: string; label: string }[] }[];
  try {
    days = JSON.parse(String(formData.get("schedule") ?? "[]"));
    if (!Array.isArray(days)) throw new Error("bad");
  } catch {
    back(path, "error", "Couldn't read the schedule. Please try again.");
  }

  const hours: { org_id: string; coach_id: string; weekday: number; start_time: string; end_time: string }[] = [];
  const breaks: { org_id: string; coach_id: string; weekday: number; start_time: string; end_time: string; label: string | null }[] = [];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const day of days) {
    const weekday = Number(day.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !day.on) continue;
    const name = dayNames[weekday];
    if (!isValidTimeInput(day.start) || !isValidTimeInput(day.end) || day.end <= day.start) {
      back(path, "error", `${name}: the start time must be before the end time.`);
    }
    hours.push({ org_id: org.id, coach_id: coachId, weekday, start_time: day.start, end_time: day.end });
    const sorted = [...(day.breaks ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    let previousEnd = "";
    for (const slot of sorted) {
      if (!isValidTimeInput(slot.start) || !isValidTimeInput(slot.end) || slot.end <= slot.start) {
        back(path, "error", `${name}: each break needs a start time before its end time.`);
      }
      if (slot.start < day.start || slot.end > day.end) {
        back(path, "error", `${name}: breaks must be within working hours (${day.start}–${day.end}).`);
      }
      if (previousEnd && slot.start < previousEnd) {
        back(path, "error", `${name}: two breaks overlap. Adjust their times.`);
      }
      previousEnd = slot.end;
      breaks.push({
        org_id: org.id,
        coach_id: coachId,
        weekday,
        start_time: slot.start,
        end_time: slot.end,
        label: String(slot.label ?? "").trim().slice(0, 60) || null
      });
    }
  }

  const [{ data: oldHours }, { data: oldBreaks }] = await Promise.all([
    supabase.from("coach_availability").select("id").eq("coach_id", coachId),
    supabase.from("coach_breaks").select("id").eq("coach_id", coachId)
  ]);

  if (hours.length > 0) {
    const { error } = await supabase.from("coach_availability").insert(hours);
    if (error) back(path, "error", friendlyError(error));
  }
  if (breaks.length > 0) {
    const { error } = await supabase.from("coach_breaks").insert(breaks);
    if (error) back(path, "error", friendlyError(error));
  }

  const oldHourIds = (oldHours ?? []).map((row: { id: string }) => row.id);
  const oldBreakIds = (oldBreaks ?? []).map((row: { id: string }) => row.id);
  if (oldHourIds.length > 0) await supabase.from("coach_availability").delete().in("id", oldHourIds);
  if (oldBreakIds.length > 0) await supabase.from("coach_breaks").delete().in("id", oldBreakIds);

  revalidatePath(path);
  back(
    path,
    "notice",
    hours.length
      ? `Working hours saved${breaks.length ? ` with ${breaks.length} break${breaks.length === 1 ? "" : "s"}` : ""}.`
      : "Working hours cleared — any time will be accepted."
  );
}

export async function addTimeOff(formData: FormData) {
  const { supabase, org, user } = await requireSession();
  const coachId = text(formData, "coach_id");
  const path = `/coaches/${coachId}`;
  const startDate = text(formData, "start_date");
  const endDate = text(formData, "end_date") || startDate;
  const allDay = formData.get("all_day") === "on";
  const startTime = allDay ? "00:00" : text(formData, "start_time");
  const endTime = allDay ? "23:59" : text(formData, "end_time");
  if (!isValidDateInput(startDate) || !isValidDateInput(endDate) || !isValidTimeInput(startTime) || !isValidTimeInput(endTime)) {
    back(path, "error", "Choose the dates (and times) for the time off.");
  }
  const startsAt = zonedToUtc(startDate, startTime, org.timezone);
  const endsAt = zonedToUtc(endDate, endTime, org.timezone);
  if (endsAt <= startsAt) back(path, "error", "The end must be after the start.");
  const { error } = await supabase.from("blocked_times").insert({
    org_id: org.id,
    coach_id: coachId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: text(formData, "reason") || null,
    created_by: user.id
  });
  if (error) back(path, "error", friendlyError(error));
  revalidatePath(path);
  back(path, "notice", "Time off added. Those hours can no longer be booked.");
}

export async function deleteBlockedTime(formData: FormData) {
  const { supabase } = await requireSession();
  const id = text(formData, "id");
  const returnTo = text(formData, "return_to") || "/coaches";
  const { error } = await supabase.from("blocked_times").delete().eq("id", id);
  if (error) back(returnTo, "error", friendlyError(error));
  revalidatePath(returnTo);
  back(returnTo, "notice", "Removed.");
}

export async function inviteCoach(formData: FormData) {
  const { supabase, org, user } = await requireSession(["admin"]);
  const coachId = text(formData, "coach_id");
  const path = `/coaches/${coachId}`;
  const { data: coach } = await supabase.from("coaches").select("id, full_name, email").eq("id", coachId).maybeSingle();
  if (!coach?.email) back(path, "error", "Add the coach's email address first.");
  const { error } = await supabase.from("invitations").insert({
    org_id: org.id,
    email: coach.email,
    role: "coach",
    full_name: coach.full_name,
    coach_id: coach.id,
    invited_by: user.id
  });
  if (error) {
    back(path, "error", error.code === "23505" ? "This coach already has an open invitation." : friendlyError(error));
  }
  revalidatePath("/team");
  back(
    path,
    "notice",
    `Invitation created. Ask ${coach.full_name} to sign up at this site with ${coach.email} — they'll be connected automatically.`
  );
}

export async function linkCoachLogin(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const coachId = text(formData, "coach_id");
  const userId = text(formData, "user_id");
  const path = `/coaches/${coachId}`;
  if (!userId) back(path, "error", "Choose the login to link.");

  const { data: member } = await supabase
    .from("memberships")
    .select("id, role, full_name, email")
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) back(path, "error", "That person isn't on your team.");

  await supabase.from("coaches").update({ user_id: null }).eq("org_id", org.id).eq("user_id", userId);
  const { error } = await supabase.from("coaches").update({ user_id: userId }).eq("id", coachId);
  if (error) back(path, "error", friendlyError(error));
  if (member.role !== "coach") {
    await supabase.from("memberships").update({ role: "coach" }).eq("id", member.id);
  }
  revalidatePath("/coaches");
  revalidatePath(path);
  back(path, "notice", `Linked. ${member.full_name || member.email} will now see this coach's sessions when they log in.`);
}

export async function unlinkCoachLogin(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const coachId = text(formData, "coach_id");
  const path = `/coaches/${coachId}`;
  const { error } = await supabase.from("coaches").update({ user_id: null }).eq("id", coachId);
  if (error) back(path, "error", friendlyError(error));
  revalidatePath(path);
  back(path, "notice", "Login unlinked from this coach.");
}
