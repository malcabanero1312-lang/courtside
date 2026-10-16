import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { parseFilters, queryAppointments } from "@/lib/appointment-query";
import { formatDate, formatTime, minutesBetween, statusLabel } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import type { AppointmentWithRelations } from "@/lib/types";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.org || !session.membership) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseFilters(params);
  const tz = session.org.timezone;
  const { data, error } = await queryAppointments(session.supabase, session.org.id, tz, filters, { all: true });
  if (error) {
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }
  const staff = session.membership.role !== "coach";
  const rows = (data ?? []) as unknown as AppointmentWithRelations[];
  const header = [
    "Reference",
    "Date",
    "Start",
    "End",
    "Minutes",
    "Status",
    "Student",
    ...(staff ? ["Student phone", "Student email"] : []),
    "Coach",
    "Venue",
    "Court",
    "Session type",
    "Handled by",
    "Contacted at",
    "Responded at",
    "Student note",
    "Cancellation reason",
    "Notes"
  ];
  const body = rows.map((a) => [
    a.reference,
    formatDate(a.starts_at, tz, "short"),
    formatTime(a.starts_at, tz),
    formatTime(a.ends_at, tz),
    minutesBetween(a.starts_at, a.ends_at),
    statusLabel(a.status),
    a.student?.full_name ?? "",
    ...(staff ? [a.student?.phone ? `+${a.student.phone}` : "", a.student?.email ?? ""] : []),
    a.coach?.full_name ?? "",
    a.venue?.name ?? "",
    a.court?.name ?? "",
    a.session_type?.name ?? "",
    a.agent?.full_name || a.agent?.email || "",
    a.contacted_at ? `${formatDate(a.contacted_at, tz, "short")} ${formatTime(a.contacted_at, tz)}` : "",
    a.responded_at ? `${formatDate(a.responded_at, tz, "short")} ${formatTime(a.responded_at, tz)}` : "",
    a.student_note ?? "",
    a.cancellation_reason ?? "",
    a.notes ?? ""
  ]);
  const csv = toCsv([header, ...body]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="appointments-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
