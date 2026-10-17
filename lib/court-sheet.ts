export interface SheetTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

export interface SheetSlot {
  date: string;
  hour: number;
  court: string;
  coach: string;
  student: string;
}

export interface SheetSession {
  date: string;
  startHour: number;
  endHour: number;
  court: string;
  coach: string;
  student: string;
}

export interface SheetDayNote {
  date: string;
  note: string;
}

export interface ParsedSheet {
  slots: SheetSlot[];
  sessions: SheetSession[];
  coaches: string[];
  notes: SheetDayNote[];
  days: string[];
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

const DAY_TITLE = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\((\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\)/i;
const TIME_LABEL = /^(\d{1,2})\s*(am|pm)$/i;
const COURT_HEADER = /courts?\s*-\s*\S+/i;
const COACH_PREFIX = /^COACH\s+(.+)$/i;

interface DayBlock {
  date: string;
  page: number;
  x: number;
  y: number;
  right: number;
  bottom: number;
}

function to24(hour: number, meridiem: string): number {
  const h = hour % 12;
  return meridiem.toLowerCase() === "pm" ? h + 12 : h;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function centerX(item: SheetTextItem): number {
  return item.x + item.width / 2;
}

export function parseCourtSheet(items: SheetTextItem[]): ParsedSheet {
  const slots: SheetSlot[] = [];
  const notes: SheetDayNote[] = [];
  const pages = Array.from(new Set(items.map((i) => i.page))).sort((a, b) => a - b);

  for (const page of pages) {
    const pageItems = items.filter((i) => i.page === page && i.str.trim());
    const titles = pageItems
      .map((item) => ({ item, match: clean(item.str).match(DAY_TITLE) }))
      .filter((t): t is { item: SheetTextItem; match: RegExpMatchArray } => Boolean(t.match));

    const blocks: DayBlock[] = titles.map(({ item, match }) => {
      const month = MONTHS[match[3].toLowerCase()] ?? 1;
      return {
        date: `${match[4]}-${pad(month)}-${pad(Number(match[2]))}`,
        page,
        x: item.x,
        y: item.y,
        right: Infinity,
        bottom: Infinity
      };
    });

    for (const block of blocks) {
      const sameRow = blocks.filter((b) => b !== block && Math.abs(b.y - block.y) < 6 && b.x > block.x);
      if (sameRow.length) block.right = Math.min(...sameRow.map((b) => b.x)) - 2;
      const below = blocks.filter((b) => b !== block && b.y > block.y + 20 && b.x < block.right && b.x + 40 > block.x - 40);
      if (below.length) block.bottom = Math.min(...below.map((b) => b.y)) - 2;
    }

    for (const block of blocks) {
      const inside = pageItems.filter(
        (i) => i.x >= block.x - 6 && centerX(i) < block.right && i.y > block.y + 2 && i.y < block.bottom
      );

      const headerNote = pageItems.find(
        (i) => Math.abs(i.y - block.y) < 4 && i.x > block.x + 20 && i.x < block.right && /^\(.*\)$/.test(clean(i.str))
      );
      if (headerNote) notes.push({ date: block.date, note: clean(headerNote.str).replace(/^\(|\)$/g, "") });

      const headers = inside.filter((i) => COURT_HEADER.test(clean(i.str)));
      if (!headers.length) continue;
      const headerY = Math.min(...headers.map((h) => h.y));
      const columns = headers
        .filter((h) => Math.abs(h.y - headerY) < 4)
        .map((h) => ({ name: clean(h.str), center: centerX(h) }))
        .sort((a, b) => a.center - b.center);

      const rows = inside
        .map((i) => ({ item: i, match: clean(i.str).match(TIME_LABEL) }))
        .filter((r): r is { item: SheetTextItem; match: RegExpMatchArray } => Boolean(r.match) && r.item.x < columns[0].center - 10)
        .map((r) => ({ hour: to24(Number(r.match[1]), r.match[2]), y: r.item.y }))
        .sort((a, b) => a.y - b.y);
      if (!rows.length) continue;

      const rowBounds = rows.map((row, idx) => {
        const prev = rows[idx - 1];
        const next = rows[idx + 1];
        const half = next ? (next.y - row.y) / 2 : prev ? (row.y - prev.y) / 2 : 10;
        return {
          hour: row.hour,
          top: prev ? (prev.y + row.y) / 2 : Math.max(headerY + 3, row.y - half),
          bottom: next ? (row.y + next.y) / 2 : row.y + half
        };
      });

      const colBounds = columns.map((col, idx) => {
        const prev = columns[idx - 1];
        const next = columns[idx + 1];
        const half = next ? (next.center - col.center) / 2 : prev ? (col.center - prev.center) / 2 : 25;
        return {
          name: col.name,
          left: prev ? (prev.center + col.center) / 2 : col.center - half,
          right: next ? (col.center + next.center) / 2 : col.center + half
        };
      });

      const cells = new Map<string, SheetTextItem[]>();
      for (const item of inside) {
        if (item.y <= headerY + 2) continue;
        const text = clean(item.str);
        if (TIME_LABEL.test(text) || COURT_HEADER.test(text)) continue;
        const cx = centerX(item);
        const col = colBounds.find((c) => cx >= c.left && cx < c.right);
        const row = rowBounds.find((r) => item.y >= r.top && item.y < r.bottom);
        if (!col || !row) continue;
        const key = `${row.hour}|${col.name}`;
        cells.set(key, [...(cells.get(key) ?? []), item]);
      }

      for (const [key, cellItems] of cells) {
        const [hourText, court] = key.split("|");
        const lines = cellItems
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((i) => clean(i.str))
          .filter(Boolean);
        const coachLine = lines.findIndex((l) => COACH_PREFIX.test(l));
        if (coachLine === -1) continue;
        const coach = clean(lines[coachLine].replace(COACH_PREFIX, "$1"));
        const student = clean(lines.filter((_, i) => i !== coachLine).join(" "));
        slots.push({ date: block.date, hour: Number(hourText), court, coach, student });
      }
    }
  }

  slots.sort((a, b) => a.date.localeCompare(b.date) || a.court.localeCompare(b.court) || a.hour - b.hour);

  const sessions: SheetSession[] = [];
  for (const slot of slots) {
    const last = sessions[sessions.length - 1];
    if (
      last &&
      last.date === slot.date &&
      last.court === slot.court &&
      last.coach.toLowerCase() === slot.coach.toLowerCase() &&
      last.endHour === slot.hour &&
      (last.student.toLowerCase() === slot.student.toLowerCase() || !slot.student)
    ) {
      last.endHour = slot.hour + 1;
      continue;
    }
    sessions.push({
      date: slot.date,
      startHour: slot.hour,
      endHour: slot.hour + 1,
      court: slot.court,
      coach: slot.coach,
      student: slot.student
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour || a.court.localeCompare(b.court));

  const coaches = Array.from(new Set(slots.map((s) => s.coach.toUpperCase()))).sort();
  const days = Array.from(new Set(slots.map((s) => s.date))).sort();
  return { slots, sessions, coaches, notes, days };
}
