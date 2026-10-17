"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { isValidDateInput, zonedToUtc } from "@/lib/time";
import { logError } from "@/lib/errors";

export interface ImportRow {
  date: string;
  startHour: number;
  endHour: number;
  court: string;
  student: string;
}

export interface ImportInput {
  coachId: string;
  venueId: string;
  daysBefore: number;
  rows: ImportRow[];
}

export interface ImportProblem {
  date: string;
  time: string;
  student: string;
  reason: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  created: number;
  alreadyThere: number;
  newStudents: number;
  newCourts: number;
  problems: ImportProblem[];
}

function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'&/(])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function hourLabel(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 ? " AM" : " PM"}`;
}

export async function importSheetSessions(input: ImportInput): Promise<ImportResult> {
  const empty: ImportResult = { ok: false, created: 0, alreadyThere: 0, newStudents: 0, newCourts: 0, problems: [] };
  const { supabase, org, user, membership } = await requireSession(["admin", "agent"]);

  const rows = (Array.isArray(input.rows) ? input.rows : [])
    .filter(
      (r) =>
        isValidDateInput(r.date) &&
        Number.isInteger(r.startHour) &&
        Number.isInteger(r.endHour) &&
        r.startHour >= 0 &&
        r.endHour > r.startHour &&
        r.endHour <= 24 &&
        typeof r.student === "string" &&
        r.student.trim()
    )
    .slice(0, 600);
  if (rows.length === 0) return { ...empty, error: "Tick at least one session with a student name." };

  const daysBefore = Math.min(Math.max(Math.round(Number(input.daysBefore) || 0), 0), 30);

  const [{ data: coach }, { data: venue }] = await Promise.all([
    supabase.from("coaches").select("id").eq("id", input.coachId).eq("org_id", org.id).maybeSingle(),
    supabase.from("venues").select("id").eq("id", input.venueId).eq("org_id", org.id).maybeSingle()
  ]);
  if (!coach) return { ...empty, error: "Choose which Courtside coach these sessions belong to." };
  if (!venue) return { ...empty, error: "Choose the venue (club) for these courts." };

  const result: ImportResult = { ...empty, ok: true };

  const { data: courtRows } = await supabase.from("courts").select("id, name").eq("venue_id", venue.id);
  const courts = new Map<string, string>((courtRows ?? []).map((c: { id: string; name: string }) => [c.name.trim().toLowerCase(), c.id]));
  const neededCourts = Array.from(new Set(rows.map((r) => r.court.trim()).filter(Boolean))).filter((name) => !courts.has(name.toLowerCase()));
  if (neededCourts.length && hasAdminClient()) {
    const admin = createAdminClient();
    const { data: made, error } = await admin
      .from("courts")
      .insert(neededCourts.map((name) => ({ org_id: org.id, venue_id: venue.id, name })))
      .select("id, name");
    if (error) logError("import-courts", error);
    for (const c of (made ?? []) as { id: string; name: string }[]) {
      courts.set(c.name.trim().toLowerCase(), c.id);
      result.newCourts += 1;
    }
  }

  const { data: studentRows } = await supabase.from("students").select("id, full_name").eq("org_id", org.id).limit(20000);
  const students = new Map<string, string>(
    (studentRows ?? []).map((s: { id: string; full_name: string }) => [s.full_name.trim().toLowerCase(), s.id])
  );

  const dates = rows.map((r) => r.date).sort();
  const rangeStart = zonedToUtc(dates[0], "00:00", org.timezone).toISOString();
  const rangeEnd = zonedToUtc(dates[dates.length - 1], "23:59", org.timezone).toISOString();
  const { data: existing } = await supabase
    .from("appointments")
    .select("starts_at")
    .eq("coach_id", coach.id)
    .gte("starts_at", rangeStart)
    .lte("starts_at", rangeEnd)
    .in("status", ["scheduled", "awaiting_response", "pending_approval", "confirmed", "reschedule_requested", "completed"]);
  const taken = new Set((existing ?? []).map((a: { starts_at: string }) => new Date(a.starts_at).getTime()));

  const batch = `sheet-${new Date().toISOString().slice(0, 16)}`;

  for (const row of rows) {
    const time = `${hourLabel(row.startHour)}–${hourLabel(row.endHour)}`;
    const startsAt = zonedToUtc(row.date, `${String(row.startHour).padStart(2, "0")}:00`, org.timezone);
    const endsAt =
      row.endHour === 24
        ? new Date(startsAt.getTime() + (24 - row.startHour) * 3600000)
        : zonedToUtc(row.date, `${String(row.endHour).padStart(2, "0")}:00`, org.timezone);

    if (taken.has(startsAt.getTime())) {
      result.alreadyThere += 1;
      continue;
    }

    const name = tidyName(row.student);
    let studentId = students.get(name.toLowerCase()) ?? students.get(row.student.trim().toLowerCase());
    if (!studentId) {
      const { data: created, error } = await supabase
        .from("students")
        .insert({ org_id: org.id, full_name: name, notes: "Added from the office court sheet", created_by: user.id })
        .select("id")
        .single();
      if (error || !created) {
        result.problems.push({ date: row.date, time, student: name, reason: "Couldn't create the student." });
        continue;
      }
      studentId = created.id as string;
      students.set(name.toLowerCase(), studentId);
      result.newStudents += 1;
    }

    const dueAt = new Date(startsAt.getTime() - daysBefore * 86400000);
    const { error } = await supabase.from("appointments").insert({
      org_id: org.id,
      reference: "",
      student_id: studentId,
      coach_id: coach.id,
      venue_id: venue.id,
      court_id: courts.get(row.court.trim().toLowerCase()) ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      assigned_agent_id: membership.id,
      office_approved: true,
      message_due_at: dueAt.toISOString(),
      import_batch: batch,
      notes: courts.has(row.court.trim().toLowerCase()) ? null : `Court on the office sheet: ${row.court}`,
      created_by: user.id
    });
    if (error) {
      result.problems.push({
        date: row.date,
        time,
        student: name,
        reason:
          error.code === "23P01"
            ? "Overlaps another booking for this coach or court already in Courtside."
            : "Couldn't save this session."
      });
      if (error.code !== "23P01") logError("import-appointment", error);
      continue;
    }
    taken.add(startsAt.getTime());
    result.created += 1;
  }

  revalidatePath("/calendar");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  revalidatePath("/students");
  return result;
}
