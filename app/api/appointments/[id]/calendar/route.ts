import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { buildIcs } from "@/lib/ics";
import { APPOINTMENT_SELECT, type AppointmentWithRelations } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.org) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const { data } = await session.supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle();
  if (!data) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }
  const a = data as unknown as AppointmentWithRelations;
  const ics = buildIcs({
    uid: a.id,
    start: a.starts_at,
    end: a.ends_at,
    title: `Tennis: ${a.student?.full_name ?? "Student"} with ${a.coach?.full_name ?? "Coach"}`,
    location: [a.venue?.name, a.court?.name, a.venue?.address].filter(Boolean).join(", "),
    description: `${a.session_type?.name ?? "Tennis session"} · Ref ${a.reference}${a.notes ? `\n${a.notes}` : ""}`,
    cancelled: a.status === "cancelled"
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${a.reference}.ics"`
    }
  });
}
