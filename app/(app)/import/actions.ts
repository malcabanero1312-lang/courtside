"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { isValidDateInput, zonedToUtc } from "@/lib/time";
import { logError } from "@/lib/errors";
import { splitSharedNames } from "@/lib/shared-lessons";

export interface ImportRow {
  date: string;
  startHour: number;
  endHour: number;
  court: string;
  student: string;
  regular?: boolean;
  matches?: { name: string; itemId: string; studentId: string; same: boolean }[];
}

export interface ImportInput {
  coachId: string;
  venueId: string;
  daysBefore: number;
  rows: ImportRow[];
  missingItemIds?: string[];
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
  sharedLessons: number;
  matched: number;
  timeChanged: number;
  missing: number;
  problems: ImportProblem[];
}

function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'&/(])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function courtKey(name: string): string {
  return name.toLowerCase().replace(/courts?/g, "court").replace(/[^a-z0-9]/g, "");
}

function hourLabel(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 ? " AM" : " PM"}`;
}

export async function importSheetSessions(input: ImportInput): Promise<ImportResult> {
  const empty: ImportResult = { ok: false, created: 0, alreadyThere: 0, newStudents: 0, newCourts: 0, sharedLessons: 0, matched: 0, timeChanged: 0, missing: 0, problems: [] };
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

  const [apptCheck, studentCheck, courtCheck] = await Promise.all([
    supabase.from("appointments").select("office_approved, message_due_at, import_batch, share_group").limit(1),
    supabase.from("students").select("is_regular").limit(1),
    supabase.from("courts").select("alt_name").limit(1)
  ]);
  const schemaError = apptCheck.error ?? studentCheck.error ?? courtCheck.error;
  if (schemaError) {
    logError("import-schema", schemaError);
    return {
      ...empty,
      error:
        "The database needs a one-time update before importing. In Supabase → SQL Editor, run the files in supabase/migrations that you haven't run yet (0007, 0008 and 0009), in order, then try again."
    };
  }

  const result: ImportResult = { ...empty, ok: true };

  const { data: courtRows } = await supabase.from("courts").select("id, name, alt_name").eq("venue_id", venue.id);
  const courts = new Map<string, string>();
  for (const c of (courtRows ?? []) as { id: string; name: string; alt_name: string | null }[]) {
    courts.set(courtKey(c.name), c.id);
    if (c.alt_name) courts.set(courtKey(c.alt_name), c.id);
  }
  const neededCourts = Array.from(new Set(rows.map((r) => r.court.trim()).filter(Boolean))).filter((name) => !courts.has(courtKey(name)));
  if (neededCourts.length && hasAdminClient()) {
    const admin = createAdminClient();
    const { data: made, error } = await admin
      .from("courts")
      .insert(neededCourts.map((name) => ({ org_id: org.id, venue_id: venue.id, name, alt_name: name })))
      .select("id, name");
    if (error) logError("import-courts", error);
    for (const c of (made ?? []) as { id: string; name: string }[]) {
      courts.set(courtKey(c.name), c.id);
      result.newCourts += 1;
    }
  }

  const { data: studentRows } = await supabase.from("students").select("id, full_name").eq("org_id", org.id).limit(20000);
  const students = new Map<string, string>(
    (studentRows ?? []).map((s: { id: string; full_name: string }) => [s.full_name.trim().toLowerCase(), s.id])
  );

  const regularMarked = new Set<string>();
  const dates = rows.map((r) => r.date).sort();
  const rangeStart = zonedToUtc(dates[0], "00:00", org.timezone).toISOString();
  const rangeEnd = zonedToUtc(dates[dates.length - 1], "23:59", org.timezone).toISOString();
  const { data: existing } = await supabase
    .from("appointments")
    .select("starts_at, student_id, share_group")
    .eq("coach_id", coach.id)
    .gte("starts_at", rangeStart)
    .lte("starts_at", rangeEnd)
    .in("status", ["scheduled", "awaiting_response", "pending_approval", "confirmed", "reschedule_requested", "completed"]);
  const taken = new Map<number, { studentId: string; shareGroup: string | null }[]>();
  for (const a of (existing ?? []) as { starts_at: string; student_id: string; share_group: string | null }[]) {
    const key = new Date(a.starts_at).getTime();
    taken.set(key, [...(taken.get(key) ?? []), { studentId: a.student_id, shareGroup: a.share_group }]);
  }

  const batch = `sheet-${new Date().toISOString().slice(0, 16)}`;

  const findOrCreateStudent = async (name: string, raw: string, regular: boolean): Promise<string | null> => {
    let studentId = students.get(name.toLowerCase()) ?? students.get(raw.trim().toLowerCase());
    if (!studentId) {
      const { data: created, error } = await supabase
        .from("students")
        .insert({
          org_id: org.id,
          full_name: name,
          is_regular: regular,
          notes: "Added from the office court sheet",
          created_by: user.id
        })
        .select("id")
        .single();
      if (error || !created) return null;
      studentId = created.id as string;
      students.set(name.toLowerCase(), studentId);
      result.newStudents += 1;
    }
    if (regular && !regularMarked.has(studentId)) {
      regularMarked.add(studentId);
      await supabase.from("students").update({ is_regular: true }).eq("id", studentId).eq("is_regular", false);
    }
    return studentId;
  };

  for (const row of rows) {
    const time = `${hourLabel(row.startHour)}–${hourLabel(row.endHour)}`;
    const startsAt = zonedToUtc(row.date, `${String(row.startHour).padStart(2, "0")}:00`, org.timezone);
    const endsAt =
      row.endHour === 24
        ? new Date(startsAt.getTime() + (24 - row.startHour) * 3600000)
        : zonedToUtc(row.date, `${String(row.endHour).padStart(2, "0")}:00`, org.timezone);
    const regular = row.regular !== false;
    const rawNames = splitSharedNames(row.student);
    const names = (rawNames.length ? rawNames : [row.student.trim()]).slice(0, 6);

    const matchList = Array.isArray(row.matches) ? row.matches : [];
    const ids: { id: string; name: string; match?: { itemId: string; same: boolean } }[] = [];
    for (const raw of names) {
      const name = tidyName(raw);
      const match = matchList.find((m) => m.name.trim().toLowerCase() === raw.trim().toLowerCase());
      if (match && match.studentId) {
        ids.push({ id: match.studentId, name, match: { itemId: match.itemId, same: Boolean(match.same) } });
        continue;
      }
      const id = await findOrCreateStudent(name, raw, regular);
      if (!id) {
        result.problems.push({ date: row.date, time, student: name, reason: "Couldn't create the student." });
        continue;
      }
      ids.push({ id, name });
    }
    if (!ids.length) continue;

    const already = taken.get(startsAt.getTime()) ?? [];
    for (const s of ids) {
      if (s.match && already.some((a) => a.studentId === s.id)) {
        await supabase.from("office_request_items").update({ result: s.match.same ? "matched" : "changed", updated_at: new Date().toISOString() }).eq("id", s.match.itemId);
        if (s.match.same) result.matched += 1;
        else result.timeChanged += 1;
      }
    }
    const missing = ids.filter((s) => !already.some((a) => a.studentId === s.id));
    if (!missing.length) {
      result.alreadyThere += 1;
      continue;
    }
    if (already.length && !(names.length > 1 && already.some((a) => ids.some((s) => s.id === a.studentId)))) {
      result.alreadyThere += 1;
      continue;
    }

    const existingGroup = already.find((a) => a.shareGroup)?.shareGroup ?? null;
    const shareGroup: string | null = names.length > 1 ? existingGroup ?? crypto.randomUUID() : null;
    if (shareGroup && already.length && !existingGroup) {
      await supabase
        .from("appointments")
        .update({ share_group: shareGroup })
        .eq("coach_id", coach.id)
        .eq("starts_at", startsAt.toISOString())
        .in("student_id", already.map((a) => a.studentId));
    }
    const dueAt = regular ? new Date(startsAt.getTime() - daysBefore * 86400000) : new Date();
    let createdHere = 0;

    for (const student of missing) {
      const same = student.match?.same === true;
      const changed = student.match ? !student.match.same : false;
      const noteParts = [
        courts.has(courtKey(row.court)) ? null : `Court on the office sheet: ${row.court}`,
        changed ? "The office gave a different time from the one requested — tell the student." : null
      ].filter(Boolean);
      const { data: inserted, error } = await supabase.from("appointments").insert({
        org_id: org.id,
        reference: "",
        student_id: student.id,
        coach_id: coach.id,
        venue_id: venue.id,
        court_id: courts.get(courtKey(row.court)) ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        assigned_agent_id: membership.id,
        office_approved: true,
        status: same ? "confirmed" : "scheduled",
        student_informed_at: same ? new Date().toISOString() : null,
        message_due_at: same ? null : (changed ? new Date() : dueAt).toISOString(),
        import_batch: batch,
        share_group: shareGroup,
        notes: noteParts.length ? noteParts.join("\n") : null,
        created_by: user.id
      }).select("id").single();
      if (error) {
        result.problems.push({
          date: row.date,
          time,
          student: student.name,
          reason:
            error.code === "23P01"
              ? "Overlaps another booking for this coach or court already in Courtside."
              : "Couldn't save this session."
        });
        if (error.code !== "23P01") logError("import-appointment", error);
        continue;
      }
      taken.set(startsAt.getTime(), [...(taken.get(startsAt.getTime()) ?? []), { studentId: student.id, shareGroup }]);
      result.created += 1;
      if (student.match) {
        await supabase
          .from("office_request_items")
          .update({ result: same ? "matched" : "changed", appointment_id: inserted?.id ?? null, updated_at: new Date().toISOString() })
          .eq("id", student.match.itemId);
        if (same) result.matched += 1;
        else result.timeChanged += 1;
      }
      createdHere += 1;
    }
    if (shareGroup && createdHere > 0) result.sharedLessons += 1;
  }

  const missingIds = (Array.isArray(input.missingItemIds) ? input.missingItemIds : []).filter((id) => typeof id === "string").slice(0, 2000);
  if (missingIds.length) {
    const { data: marked } = await supabase
      .from("office_request_items")
      .update({ result: "missing", updated_at: new Date().toISOString() })
      .in("id", missingIds)
      .eq("result", "pending")
      .select("id");
    result.missing = (marked ?? []).length;
  }

  revalidatePath("/regulars");
  revalidatePath("/calendar");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  revalidatePath("/students");
  return result;
}
