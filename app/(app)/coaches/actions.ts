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
  const rows: { org_id: string; coach_id: string; weekday: number; start_time: string; end_time: string }[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (formData.get(`on_${weekday}`) !== "on") continue;
    const start = text(formData, `start_${weekday}`);
    const end = text(formData, `end_${weekday}`);
    if (!isValidTimeInput(start) || !isValidTimeInput(end) || end <= start) {
      back(path, "error", "Each working day needs a start time before its end time.");
    }
    rows.push({ org_id: org.id, coach_id: coachId, weekday, start_time: start, end_time: end });
  }
  const { data: previous } = await supabase.from("coach_availability").select("id").eq("coach_id", coachId);
  if (rows.length > 0) {
    const { error } = await supabase.from("coach_availability").insert(rows);
    if (error) back(path, "error", friendlyError(error));
  }
  const oldIds = (previous ?? []).map((row: { id: string }) => row.id);
  if (oldIds.length > 0) {
    const { error: deleteError } = await supabase.from("coach_availability").delete().in("id", oldIds);
    if (deleteError) back(path, "error", friendlyError(deleteError));
  }
  revalidatePath(path);
  back(path, "notice", rows.length ? "Working hours saved." : "Working hours cleared — any time will be accepted.");
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
