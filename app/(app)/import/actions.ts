"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { isValidDateInput, zonedToUtc } from "@/lib/time";
import { logError } from "@/lib/errors";
import { splitSharedNames } from "@/lib/shared-lessons";
import { weekdayOfDate } from "@/lib/regular";

export interface ImportMatch {
  name: string;
  appointmentId: string;
  studentId: string;
  same: boolean;
}

export interface ImportRow {
  date: string;
  startHour: number;
  endHour: number;
  court: string;
  student: string;
  matches?: ImportMatch[];
}

export interface ImportInput {
  coachId: string;
  venueId: string;
  rows: ImportRow[];
  missingAppointmentIds?: string[];
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
  weeklySchedules: number;
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

function hhmm(hour: number): string {
  return `${String(hour % 24).padStart(2, "0")}:00`;
}

const ACTIVE = ["scheduled", "awaiting_response", "pending_approval", "confirmed", "reschedule_requested", "completed"];

export async function importSheetSessions(input: ImportInput): Promise<ImportResult> {
  const empty: ImportResult = {
    ok: false,
    created: 0,
    alreadyThere: 0,
    newStudents: 0,
    newCourts: 0,
    sharedLessons: 0,
    matched: 0,
    timeChanged: 0,
    missing: 0,
    weeklySchedules: 0,
    problems: []
  };
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

  const [{ data: coach }, { data: venue }] = await Promise.all([
    supabase.from("coaches").select("id").eq("id", input.coachId).eq("org_id", org.id).maybeSingle(),
    supabase.from("venues").select("id").eq("id", input.venueId).eq("org_id", org.id).maybeSingle()
  ]);
  if (!coach) return { ...empty, error: "Choose which Courtside coach these sessions belong to." };
  if (!venue) return { ...empty, error: "Choose the venue (club) for these courts." };

  const [apptCheck, studentCheck, courtCheck, slotCheck] = await Promise.all([
    supabase.from("appointments").select("office_approved, import_batch, share_group, monthly_id").limit(1),
    supabase.from("students").select("is_regular").limit(1),
    supabase.from("courts").select("alt_name").limit(1),
    supabase.from("regular_slots").select("id, venue_id").limit(1)
  ]);
  const schemaError = apptCheck.error ?? studentCheck.error ?? courtCheck.error ?? slotCheck.error;
  if (schemaError) {
    logError("import-schema", schemaError);
    return {
      ...empty,
      error:
        "The database needs a one-time update before importing. In Supabase → SQL Editor, run the files in supabase/migrations that you haven't run yet (up to 0012), in order, then try again."
    };
  }

  const result: ImportResult = { ...empty, ok: true };
  const now = new Date().toISOString();

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

  const dates = rows.map((r) => r.date).sort();
  const rangeStart = zonedToUtc(dates[0], "00:00", org.timezone).toISOString();
  const rangeEnd = zonedToUtc(dates[dates.length - 1], "23:59", org.timezone).toISOString();
  const { data: existing } = await supabase
    .from("appointments")
    .select("starts_at, student_id, share_group")
    .eq("coach_id", coach.id)
    .gte("starts_at", rangeStart)
    .lte("starts_at", rangeEnd)
    .in("status", ACTIVE);
  const taken = new Map<number, { studentId: string; shareGroup: string | null }[]>();
  for (const a of (existing ?? []) as { starts_at: string; student_id: string; share_group: string | null }[]) {
    const key = new Date(a.starts_at).getTime();
    taken.set(key, [...(taken.get(key) ?? []), { studentId: a.student_id, shareGroup: a.share_group }]);
  }

  const batch = `sheet-${now.slice(0, 16)}`;
  const touched = new Set<string>();
  const patterns = new Map<string, { studentId: string; weekday: number; start: string; end: string; n: number }>();

  const remember = (studentId: string, date: string, startHour: number, endHour: number) => {
    touched.add(studentId);
    const weekday = weekdayOfDate(date);
    const key = `${studentId}|${weekday}|${startHour}|${endHour}`;
    const p = patterns.get(key) ?? { studentId, weekday, start: hhmm(startHour), end: endHour === 24 ? "23:59" : hhmm(endHour), n: 0 };
    p.n += 1;
    patterns.set(key, p);
  };

  const findOrCreateStudent = async (name: string, raw: string): Promise<string | null> => {
    const existingId = students.get(name.toLowerCase()) ?? students.get(raw.trim().toLowerCase());
    if (existingId) return existingId;
    const { data: created, error } = await supabase
      .from("students")
      .insert({ org_id: org.id, full_name: name, is_regular: true, notes: "Added from the office court sheet", created_by: user.id })
      .select("id")
      .single();
    if (error || !created) return null;
    students.set(name.toLowerCase(), created.id as string);
    result.newStudents += 1;
    return created.id as string;
  };

  for (const row of rows) {
    const time = `${hourLabel(row.startHour)}–${hourLabel(row.endHour)}`;
    const startsAt = zonedToUtc(row.date, hhmm(row.startHour), org.timezone);
    const endsAt =
      row.endHour === 24
        ? new Date(startsAt.getTime() + (24 - row.startHour) * 3600000)
        : zonedToUtc(row.date, hhmm(row.endHour), org.timezone);
    const courtId = courts.get(courtKey(row.court)) ?? null;
    const courtNote = courtId ? null : `Court on the office sheet: ${row.court}`;
    const rawNames = splitSharedNames(row.student);
    const names = (rawNames.length ? rawNames : [row.student.trim()]).slice(0, 6);
    const matchList = Array.isArray(row.matches) ? row.matches : [];

    const people: { id: string; name: string; match?: ImportMatch }[] = [];
    for (const raw of names) {
      const name = tidyName(raw);
      const match = matchList.find((m) => m.name.trim().toLowerCase() === raw.trim().toLowerCase() && m.studentId && m.appointmentId);
      if (match) {
        people.push({ id: match.studentId, name, match });
        continue;
      }
      const id = await findOrCreateStudent(name, raw);
      if (!id) {
        result.problems.push({ date: row.date, time, student: name, reason: "Couldn't create the student." });
        continue;
      }
      people.push({ id, name });
    }
    if (!people.length) continue;

    const already = taken.get(startsAt.getTime()) ?? [];
    const existingGroup = already.find((a) => a.shareGroup)?.shareGroup ?? null;
    const shareGroup: string | null = names.length > 1 ? existingGroup ?? crypto.randomUUID() : null;
    let createdHere = 0;

    for (const person of people) {
      if (person.match) {
        const changes: Record<string, unknown> = {
          status: "confirmed",
          office_approved: true,
          court_id: courtId,
          import_batch: batch
        };
        if (!person.match.same) {
          changes.starts_at = startsAt.toISOString();
          changes.ends_at = endsAt.toISOString();
          changes.student_informed_at = null;
          changes.office_note = `The office gave ${time} on the sheet — different from what was requested.`;
        }
        if (shareGroup) changes.share_group = shareGroup;
        const { error } = await supabase.from("appointments").update(changes).eq("id", person.match.appointmentId);
        if (error) {
          result.problems.push({
            date: row.date,
            time,
            student: person.name,
            reason: error.code === "23P01" ? "The office's time overlaps another booking in Courtside." : "Couldn't update the session."
          });
          if (error.code !== "23P01") logError("import-match", error);
          continue;
        }
        if (person.match.same) {
          await supabase.from("appointments").update({ student_informed_at: now }).eq("id", person.match.appointmentId);
          result.matched += 1;
        } else {
          result.timeChanged += 1;
        }
        taken.set(startsAt.getTime(), [...(taken.get(startsAt.getTime()) ?? []), { studentId: person.id, shareGroup }]);
        remember(person.id, row.date, row.startHour, row.endHour);
        continue;
      }

      if (already.some((a) => a.studentId === person.id)) {
        result.alreadyThere += 1;
        remember(person.id, row.date, row.startHour, row.endHour);
        continue;
      }

      if (shareGroup && already.length && !existingGroup) {
        await supabase
          .from("appointments")
          .update({ share_group: shareGroup })
          .eq("coach_id", coach.id)
          .eq("starts_at", startsAt.toISOString())
          .in("student_id", already.map((a) => a.studentId));
      }

      const { error } = await supabase.from("appointments").insert({
        org_id: org.id,
        reference: "",
        student_id: person.id,
        coach_id: coach.id,
        venue_id: venue.id,
        court_id: courtId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        assigned_agent_id: membership.id,
        status: "confirmed",
        office_approved: true,
        student_informed_at: now,
        import_batch: batch,
        share_group: shareGroup,
        notes: courtNote,
        created_by: user.id
      });
      if (error) {
        result.problems.push({
          date: row.date,
          time,
          student: person.name,
          reason: error.code === "23P01" ? "Overlaps another booking for this coach or court already in Courtside." : "Couldn't save this session."
        });
        if (error.code !== "23P01") logError("import-appointment", error);
        continue;
      }
      taken.set(startsAt.getTime(), [...(taken.get(startsAt.getTime()) ?? []), { studentId: person.id, shareGroup }]);
      result.created += 1;
      createdHere += 1;
      remember(person.id, row.date, row.startHour, row.endHour);
    }
    if (shareGroup && createdHere > 0) result.sharedLessons += 1;
  }

  const missingIds = (Array.isArray(input.missingAppointmentIds) ? input.missingAppointmentIds : [])
    .filter((id) => typeof id === "string")
    .slice(0, 2000);
  if (missingIds.length) {
    const { data: marked } = await supabase
      .from("appointments")
      .update({ status: "not_approved", office_note: "Not on the office's court sheet." })
      .in("id", missingIds)
      .eq("status", "pending_approval")
      .select("id");
    result.missing = (marked ?? []).length;
  }

  if (touched.size) {
    const byStudent = new Map<string, { weekday: number; start: string; end: string; n: number }[]>();
    for (const p of patterns.values()) byStudent.set(p.studentId, [...(byStudent.get(p.studentId) ?? []), p]);
    const slots: {
      org_id: string;
      student_id: string;
      coach_id: string;
      venue_id: string;
      weekday: number;
      start_time: string;
      end_time: string;
    }[] = [];
    for (const [studentId, list] of byStudent) {
      const repeating = list.filter((p) => p.n >= 2);
      for (const p of repeating.length ? repeating : list) {
        slots.push({
          org_id: org.id,
          student_id: studentId,
          coach_id: coach.id,
          venue_id: venue.id,
          weekday: p.weekday,
          start_time: p.start,
          end_time: p.end
        });
      }
    }
    const ids = Array.from(byStudent.keys());
    const { error: deleteError } = await supabase.from("regular_slots").delete().in("student_id", ids).eq("coach_id", coach.id);
    if (!deleteError && slots.length) {
      const { error: slotError } = await supabase.from("regular_slots").insert(slots);
      if (slotError) logError("import-slots", slotError);
      else result.weeklySchedules = ids.length;
    }
    await supabase.from("students").update({ is_regular: true }).in("id", ids).eq("is_regular", false);
  }

  revalidatePath("/regulars");
  revalidatePath("/calendar");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  revalidatePath("/students");
  return result;
}
