"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { isValidDateInput, isValidTimeInput, zonedToUtc } from "@/lib/time";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(kind: "notice" | "error", message: string): never {
  redirect(`/venues?${kind}=${encodeURIComponent(message)}`);
}

function readVenue(formData: FormData) {
  const opens = text(formData, "opens_at") || "06:00";
  const closes = text(formData, "closes_at") || "22:00";
  const maps = text(formData, "maps_url");
  return {
    values: {
      name: text(formData, "name"),
      address: text(formData, "address") || null,
      maps_url: maps && /^https?:\/\//.test(maps) ? maps : null,
      opens_at: opens,
      closes_at: closes,
      notes: text(formData, "notes") || null
    },
    error: !text(formData, "name")
      ? "Enter the venue name."
      : !isValidTimeInput(opens) || !isValidTimeInput(closes) || closes <= opens
        ? "Opening time must be before closing time."
        : null
  };
}

export async function createVenue(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const { values, error } = readVenue(formData);
  if (error) back("error", error);
  const { data, error: dbError } = await supabase.from("venues").insert({ ...values, org_id: org.id }).select("id").single();
  if (dbError || !data) back("error", friendlyError(dbError));
  const courtCount = Math.min(Math.max(Number(text(formData, "court_count")) || 0, 0), 30);
  if (courtCount > 0) {
    await supabase.from("courts").insert(
      Array.from({ length: courtCount }, (_, i) => ({ org_id: org.id, venue_id: data.id, name: `Court ${i + 1}` }))
    );
  }
  revalidatePath("/venues");
  back("notice", `Venue added${courtCount ? ` with ${courtCount} court${courtCount === 1 ? "" : "s"}` : ""}.`);
}

export async function updateVenue(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const { values, error } = readVenue(formData);
  if (error) back("error", error);
  const { error: dbError } = await supabase
    .from("venues")
    .update({ ...values, is_active: formData.get("is_active") === "on" })
    .eq("id", text(formData, "id"));
  if (dbError) back("error", friendlyError(dbError));
  revalidatePath("/venues");
  back("notice", "Venue saved.");
}

export async function addCourt(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const name = text(formData, "name");
  if (!name) back("error", "Enter a court name.");
  const { error } = await supabase.from("courts").insert({
    org_id: org.id,
    venue_id: text(formData, "venue_id"),
    name,
    surface: text(formData, "surface") || null
  });
  if (error) back("error", error.code === "23505" ? "That venue already has a court with this name." : friendlyError(error));
  revalidatePath("/venues");
  back("notice", "Court added.");
}

export async function toggleCourt(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const active = text(formData, "active") === "1";
  const { error } = await supabase.from("courts").update({ is_active: active }).eq("id", text(formData, "id"));
  if (error) back("error", friendlyError(error));
  revalidatePath("/venues");
  back("notice", active ? "Court reopened." : "Court closed for booking. Existing bookings are kept.");
}

export async function addClosure(formData: FormData) {
  const { supabase, org, user } = await requireSession(["admin", "agent"]);
  const target = text(formData, "target");
  const [kind, id] = target.split(":");
  const startDate = text(formData, "start_date");
  const endDate = text(formData, "end_date") || startDate;
  const startTime = text(formData, "start_time") || "00:00";
  const endTime = text(formData, "end_time") || "23:59";
  if (!["venue", "court"].includes(kind) || !id) back("error", "Choose a venue or court.");
  if (!isValidDateInput(startDate) || !isValidDateInput(endDate) || !isValidTimeInput(startTime) || !isValidTimeInput(endTime)) {
    back("error", "Choose the dates and times.");
  }
  const startsAt = zonedToUtc(startDate, startTime, org.timezone);
  const endsAt = zonedToUtc(endDate, endTime, org.timezone);
  if (endsAt <= startsAt) back("error", "The end must be after the start.");
  const { error } = await supabase.from("blocked_times").insert({
    org_id: org.id,
    venue_id: kind === "venue" ? id : null,
    court_id: kind === "court" ? id : null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: text(formData, "reason") || null,
    created_by: user.id
  });
  if (error) back("error", friendlyError(error));
  revalidatePath("/venues");
  back("notice", "Closure added. Those hours can no longer be booked.");
}
