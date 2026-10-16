import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { checkSlot, validateSlotInput, type SlotInput } from "@/lib/scheduling";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.org || !session.membership) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input: SlotInput = {
    coachId: String(body.coachId ?? ""),
    venueId: String(body.venueId ?? ""),
    courtId: body.courtId ? String(body.courtId) : null,
    studentId: body.studentId ? String(body.studentId) : null,
    date: String(body.date ?? ""),
    time: String(body.time ?? ""),
    duration: Number(body.duration),
    excludeId: body.excludeId ? String(body.excludeId) : null
  };
  const invalid = validateSlotInput(input);
  if (invalid) {
    return NextResponse.json({ incomplete: true, message: invalid });
  }
  const result = await checkSlot(session.supabase, session.org, input);
  return NextResponse.json(result);
}
