import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/admin";
import { buildFeed, type FeedEvent } from "@/lib/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedRow {
  id: string;
  share_group: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  reference: string;
  updated_at: string;
  version: number;
  student: string;
  coach: string;
  venue: string;
  venue_address: string | null;
  court: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  scheduled: "Not yet confirmed by the student",
  awaiting_response: "Waiting for the student",
  pending_approval: "Waiting for the office",
  confirmed: "Confirmed",
  reschedule_requested: "Student asked for another time",
  completed: "Completed",
  no_show: "No-show"
};

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const token = file.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("calendar_feed_events", { p_token: token });
  const result = (data ?? {}) as { found?: boolean; events?: FeedRow[]; org_name?: string; coach_name?: string | null };
  if (error || !result.found) {
    return new NextResponse("Not found", { status: 404 });
  }

  const groups = new Map<string, FeedRow[]>();
  for (const row of result.events ?? []) {
    const key = row.share_group ? `${row.share_group}|${row.starts_at}|${row.ends_at}` : row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const events: FeedEvent[] = Array.from(groups.values()).map((rows) => {
    const first = rows[0];
    const names = rows.map((r) => r.student).join(" / ");
    const waiting = rows.some((r) => r.status !== "confirmed" && r.status !== "completed");
    const stamp = rows.map((r) => r.updated_at).sort().at(-1) ?? first.updated_at;
    const title = `${waiting ? "(Waiting) " : ""}🎾 ${names}${result.coach_name ? "" : ` · Coach ${first.coach}`}`;
    const location = [first.venue, first.court].filter(Boolean).join(" · ") + (first.venue_address ? `, ${first.venue_address}` : "");
    const description = rows
      .map((r) => `${r.student}: ${STATUS_TEXT[r.status] ?? r.status}${r.reference ? ` (${r.reference})` : ""}`)
      .concat([`Coach ${first.coach}`, "Updated automatically by Courtside."])
      .join("\n");
    return {
      uid: first.share_group ? `${first.share_group}-${new Date(first.starts_at).getTime()}` : first.id,
      start: first.starts_at,
      end: first.ends_at,
      title,
      location,
      description,
      stamp,
      sequence: rows.reduce((sum, r) => sum + (r.version ?? 1), 0),
      tentative: waiting
    };
  });

  const name = result.coach_name ? `Tennis · Coach ${result.coach_name}` : `Tennis · ${result.org_name ?? "Courtside"}`;
  return new NextResponse(buildFeed(name, events), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="courtside.ics"`,
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
