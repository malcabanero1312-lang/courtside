import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, formatTime } from "@/lib/format";
import { isValidDateInput, isValidTimeInput, utcToZonedInputs, zonedToUtc } from "@/lib/time";
import type { Organization, SlotIssue, SlotSuggestion } from "@/lib/types";

export interface SlotInput {
  coachId: string;
  venueId: string;
  courtId: string | null;
  studentId: string | null;
  date: string;
  time: string;
  duration: number;
  excludeId?: string | null;
}

export interface SlotCheck {
  issues: SlotIssue[];
  suggestions: SlotSuggestion[];
  startsAt: string | null;
  endsAt: string | null;
}

export function validateSlotInput(input: SlotInput): string | null {
  if (!input.coachId) return "Choose a coach.";
  if (!input.venueId) return "Choose a venue.";
  if (!isValidDateInput(input.date)) return "Choose a date.";
  if (!isValidTimeInput(input.time)) return "Choose a start time.";
  if (!Number.isFinite(input.duration) || input.duration < 15 || input.duration > 480) {
    return "Session length must be between 15 minutes and 8 hours.";
  }
  return null;
}

export async function checkSlot(
  supabase: SupabaseClient,
  org: Pick<Organization, "id" | "timezone">,
  input: SlotInput,
  withSuggestions = true
): Promise<SlotCheck> {
  const startsAt = zonedToUtc(input.date, input.time, org.timezone);
  const endsAt = new Date(startsAt.getTime() + input.duration * 60000);

  const { data: issueRows, error } = await supabase.rpc("slot_issues", {
    p_org: org.id,
    p_coach: input.coachId,
    p_venue: input.venueId,
    p_court: input.courtId,
    p_starts: startsAt.toISOString(),
    p_ends: endsAt.toISOString(),
    p_student: input.studentId,
    p_exclude: input.excludeId ?? null
  });

  const issues: SlotIssue[] = error
    ? [{ code: "check_failed", severity: "warn", message: "We couldn't double-check availability right now." }]
    : ((issueRows ?? []) as SlotIssue[]);

  let suggestions: SlotSuggestion[] = [];
  if (withSuggestions && issues.some((issue) => issue.severity === "block")) {
    const { data: slotRows } = await supabase.rpc("suggest_slots", {
      p_org: org.id,
      p_coach: input.coachId,
      p_venue: input.venueId,
      p_court: input.courtId,
      p_from: new Date(Math.max(startsAt.getTime() - 3 * 3600000, Date.now())).toISOString(),
      p_duration_minutes: input.duration,
      p_exclude: input.excludeId ?? null,
      p_limit: 6
    });
    suggestions = ((slotRows ?? []) as { starts_at: string; ends_at: string; court_id: string | null }[]).map((row) => {
      const local = utcToZonedInputs(row.starts_at, org.timezone);
      return {
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        court_id: row.court_id,
        date: local.date,
        time: local.time,
        label: `${formatDate(row.starts_at, org.timezone, "short")} · ${formatTime(row.starts_at, org.timezone)}`
      };
    });
  }

  return { issues, suggestions, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}
