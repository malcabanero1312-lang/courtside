import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { buildXlsx, cellRef, type CellStyle, type Sheet, type SheetCell } from "@/lib/xlsx";
import { addDays, isValidDateInput, startOfWeek, todayInZone, utcToZonedInputs, zonedToUtc } from "@/lib/time";
import { formatTime, statusLabel } from "@/lib/format";
import { APPOINTMENT_SELECT, type AppointmentStatus, type AppointmentWithRelations } from "@/lib/types";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function styleFor(status: AppointmentStatus): CellStyle {
  if (status === "confirmed" || status === "completed") return "confirmed";
  if (status === "cancelled" || status === "rescheduled") return "muted";
  if (status === "declined" || status === "not_approved" || status === "no_show") return "attention";
  return "pending";
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.org || !session.membership) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const { supabase, org } = session;
  const tz = org.timezone;
  const params = request.nextUrl.searchParams;
  const requested = params.get("week") ?? "";
  const firstWeek = startOfWeek(isValidDateInput(requested) ? requested : todayInZone(tz));
  const weeks = Math.min(Math.max(Number(params.get("weeks")) || 1, 1), 8);
  const coach = params.get("coach") ?? "";
  const venue = params.get("venue") ?? "";
  const showCancelled = params.get("cancelled") === "1";

  let query = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("org_id", org.id)
    .gte("starts_at", zonedToUtc(firstWeek, "00:00", tz).toISOString())
    .lt("starts_at", zonedToUtc(addDays(firstWeek, weeks * 7), "00:00", tz).toISOString())
    .neq("status", "rescheduled")
    .order("starts_at")
    .limit(5000);
  if (!showCancelled) query = query.not("status", "in", "(cancelled,declined,not_approved)");
  if (coach) query = query.eq("coach_id", coach);
  if (venue) query = query.eq("venue_id", venue);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Download failed. Please try again." }, { status: 500 });
  }
  const appointments = (data ?? []) as unknown as AppointmentWithRelations[];

  const byDay = new Map<string, AppointmentWithRelations[]>();
  for (const a of appointments) {
    const key = utcToZonedInputs(a.starts_at, tz).date;
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }

  const sheets: Sheet[] = [];
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(firstWeek, w * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const rows: Sheet["rows"] = [];

    rows.push({
      cells: [
        { value: `${org.name} — Week of ${shortDate(days[0])} to ${shortDate(days[6])}`, style: "title" },
        ...Array.from({ length: 6 }, () => ({ value: "", style: "title" as CellStyle }))
      ],
      height: 28
    });

    rows.push({
      cells: days.map((day, i) => {
        const count = byDay.get(day)?.length ?? 0;
        return {
          value: `${DAY_NAMES[i]}\n${shortDate(day)}\n${count} session${count === 1 ? "" : "s"}`,
          style: "header" as CellStyle
        };
      }),
      height: 50
    });

    const longest = Math.max(1, ...days.map((day) => byDay.get(day)?.length ?? 0));
    for (let r = 0; r < longest; r++) {
      let maxLines = 1;
      const cells: SheetCell[] = days.map((day) => {
        const list = byDay.get(day) ?? [];
        const a = list[r];
        if (!a) {
          return { value: r === 0 ? "No sessions" : "", style: r === 0 ? "empty" : "cell" };
        }
        const lines = [
          `${formatTime(a.starts_at, tz)} – ${formatTime(a.ends_at, tz)}`,
          a.student?.full_name ?? "Student",
          `Coach ${a.coach?.full_name ?? ""}`.trim(),
          [a.venue?.name, a.court?.name].filter(Boolean).join(" · "),
          [a.session_type?.name, statusLabel(a.status)].filter(Boolean).join(" · ")
        ].filter(Boolean);
        maxLines = Math.max(maxLines, lines.length);
        return { value: lines.join("\n"), style: styleFor(a.status) };
      });
      rows.push({ cells, height: maxLines * 15 + 8 });
    }

    sheets.push({
      name: `Week ${shortDate(weekStart).replace(/ \d{4}$/, "")}`,
      columnWidths: Array.from({ length: 7 }, () => 30),
      rows,
      merges: [`${cellRef(0, 0)}:${cellRef(6, 0)}`],
      freezeRows: 2
    });
  }

  const file = buildXlsx(sheets);
  const filename = `schedule-${firstWeek}${weeks > 1 ? `-${weeks}-weeks` : ""}.xlsx`;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
