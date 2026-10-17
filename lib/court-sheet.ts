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

export interface CoachAlias {
  label: string;
  names: string[];
}

export interface ParseOptions {
  coachAliases?: CoachAlias[];
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

const WEEKDAY = "(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*";
const COURT_HEADER = /\bcourts?\b|\bct\.?\s*\d/i;
const COACH_PREFIX = /^(?:coach\b|ch\.|ch\b)\s*[:\-]?\s*(.+)$/i;

interface DayBlock {
  date: string;
  page: number;
  x: number;
  y: number;
  right: number;
  bottom: number;
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

function monthNumber(word: string): number | null {
  const key = word.toLowerCase().replace(/\.$/, "");
  if (MONTHS[key]) return MONTHS[key];
  const short = key.slice(0, 3);
  return key.length >= 3 && MONTHS[short] ? MONTHS[short] : null;
}

function validDate(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseDateText(raw: string, fallbackYear: number): string | null {
  const text = clean(raw);
  if (!text || text.length > 70) return null;
  let m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b/);
  if (m && monthNumber(m[2])) return validDate(Number(m[3]), monthNumber(m[2]) as number, Number(m[1]));
  m = text.match(/\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && monthNumber(m[1])) return validDate(Number(m[3]), monthNumber(m[1]) as number, Number(m[2]));
  m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return b > 12 ? validDate(y, a, b) : validDate(y, b, a);
  }
  const weekdayFirst = new RegExp(`^${WEEKDAY}\\.?,?\\s*\\(?`, "i");
  if (weekdayFirst.test(text)) {
    const rest = text.replace(weekdayFirst, "");
    m = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\b/);
    if (m && monthNumber(m[2])) return validDate(fallbackYear, monthNumber(m[2]) as number, Number(m[1]));
    m = rest.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})\b/);
    if (m && monthNumber(m[1])) return validDate(fallbackYear, monthNumber(m[1]) as number, Number(m[2]));
    m = rest.match(/^(\d{1,2})[/.](\d{1,2})\b/);
    if (m) return validDate(fallbackYear, Number(m[2]), Number(m[1]));
  }
  return null;
}

export function parseTimeLabel(raw: string): number | null {
  const text = clean(raw).toLowerCase().replace(/\./g, "");
  const m = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?$/);
  if (!m) return null;
  const hasMeridiem = Boolean(m[3]);
  const hasColon = m[2] !== undefined;
  if (!hasMeridiem && !hasColon) return null;
  let hour = Number(m[1]);
  if (hour > 23) return null;
  if (hasMeridiem) {
    hour = hour % 12;
    if (m[3] === "pm") hour += 12;
  }
  return hour;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasMatchers(aliases: CoachAlias[]): { label: string; re: RegExp }[] {
  const list: { label: string; re: RegExp; length: number }[] = [];
  for (const alias of aliases) {
    for (const name of alias.names) {
      const n = clean(name);
      if (n.length < 2) continue;
      list.push({ label: alias.label, re: new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(n)}(?=$|[^A-Za-z0-9])`, "i"), length: n.length });
    }
  }
  return list.sort((a, b) => b.length - a.length);
}

function readCell(lines: string[], matchers: { label: string; re: RegExp }[]): { coach: string; student: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const matcher of matchers) {
      if (matcher.re.test(line)) {
        const remainder = clean(line.replace(matcher.re, "$1").replace(/^\s*(?:coach\b|ch\.|ch\b)\s*[:\-]?/i, "").replace(/^[\s:\-–|/]+|[\s:\-–|/]+$/g, ""));
        const student = clean([remainder, ...lines.filter((_, j) => j !== i)].filter(Boolean).join(" "));
        return { coach: matcher.label.toUpperCase(), student };
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const prefix = lines[i].match(COACH_PREFIX);
    if (prefix) {
      const coachText = clean(prefix[1]);
      const student = clean(lines.filter((_, j) => j !== i).join(" "));
      return { coach: coachText.toUpperCase(), student };
    }
  }
  return null;
}

function findYear(items: SheetTextItem[]): number {
  const counts = new Map<number, number>();
  for (const item of items) {
    for (const m of item.str.matchAll(/\b(20\d{2})\b/g)) {
      const y = Number(m[1]);
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
  }
  let best = new Date().getUTCFullYear();
  let bestCount = 0;
  counts.forEach((count, year) => {
    if (count > bestCount) {
      best = year;
      bestCount = count;
    }
  });
  return best;
}

export function parseCourtSheet(items: SheetTextItem[], options: ParseOptions = {}): ParsedSheet {
  const slots: SheetSlot[] = [];
  const notes: SheetDayNote[] = [];
  const matchers = aliasMatchers(options.coachAliases ?? []);
  const year = findYear(items);
  const pages = Array.from(new Set(items.map((i) => i.page))).sort((a, b) => a - b);

  for (const page of pages) {
    const pageItems = items.filter((i) => i.page === page && i.str.trim());
    const titles = pageItems
      .map((item) => ({ item, date: COURT_HEADER.test(item.str) || parseTimeLabel(item.str) !== null ? null : parseDateText(item.str, year) }))
      .filter((t): t is { item: SheetTextItem; date: string } => Boolean(t.date));

    const blocks: DayBlock[] = titles.map(({ item, date }) => ({ date, page, x: item.x, y: item.y, right: Infinity, bottom: Infinity }));

    for (const block of blocks) {
      const sameRow = blocks.filter((b) => b !== block && Math.abs(b.y - block.y) < 6 && b.x > block.x);
      if (sameRow.length) block.right = Math.min(...sameRow.map((b) => b.x)) - 2;
      const below = blocks.filter((b) => b !== block && b.y > block.y + 20 && b.x < block.right && b.x + 40 > block.x - 40);
      if (below.length) block.bottom = Math.min(...below.map((b) => b.y)) - 2;
    }

    for (const block of blocks) {
      const inside = pageItems.filter((i) => i.x >= block.x - 6 && centerX(i) < block.right && i.y > block.y + 2 && i.y < block.bottom);

      const headerNote = pageItems.find(
        (i) => Math.abs(i.y - block.y) < 4 && i.x > block.x + 20 && i.x < block.right && /^\(.*\)$/.test(clean(i.str))
      );
      if (headerNote) notes.push({ date: block.date, note: clean(headerNote.str).replace(/^\(|\)$/g, "") });

      const timeItems = inside
        .map((i) => ({ item: i, hour: parseTimeLabel(i.str) }))
        .filter((t): t is { item: SheetTextItem; hour: number } => t.hour !== null);
      const courtItems = inside.filter((i) => COURT_HEADER.test(clean(i.str)) && clean(i.str).length <= 32);
      if (!timeItems.length || !courtItems.length) continue;

      const xs = timeItems.map((t) => centerX(t.item));
      const ys = timeItems.map((t) => t.item.y);
      const vertical = Math.max(...ys) - Math.min(...ys) >= Math.max(...xs) - Math.min(...xs);

      let rowAxis: { key: string; pos: number }[];
      let colAxis: { key: string; pos: number }[];
      let rowIsTime: boolean;
      let gridTop: number;
      let gridLeft: number;

      if (vertical) {
        const headerY = Math.min(...courtItems.map((h) => h.y));
        const headers = courtItems.filter((h) => Math.abs(h.y - headerY) < 4);
        const firstCol = Math.min(...headers.map(centerX));
        rowAxis = timeItems
          .filter((t) => centerX(t.item) < firstCol - 10)
          .map((t) => ({ key: String(t.hour), pos: t.item.y }));
        colAxis = headers.map((h) => ({ key: clean(h.str), pos: centerX(h) }));
        rowIsTime = true;
        gridTop = headerY + 2;
        gridLeft = -Infinity;
      } else {
        const headerY = Math.min(...timeItems.map((t) => t.item.y));
        const times = timeItems.filter((t) => Math.abs(t.item.y - headerY) < 4);
        const firstCol = Math.min(...times.map((t) => centerX(t.item)));
        colAxis = times.map((t) => ({ key: String(t.hour), pos: centerX(t.item) }));
        rowAxis = courtItems.filter((c) => centerX(c) < firstCol - 10).map((c) => ({ key: clean(c.str), pos: c.y }));
        rowIsTime = false;
        gridTop = headerY + 2;
        gridLeft = -Infinity;
      }
      if (!rowAxis.length || !colAxis.length) continue;
      rowAxis.sort((a, b) => a.pos - b.pos);
      colAxis.sort((a, b) => a.pos - b.pos);

      const bounds = (axis: { key: string; pos: number }[], fallback: number, minStart: number) =>
        axis.map((entry, idx) => {
          const prev = axis[idx - 1];
          const next = axis[idx + 1];
          const half = next ? (next.pos - entry.pos) / 2 : prev ? (entry.pos - prev.pos) / 2 : fallback;
          return {
            key: entry.key,
            start: prev ? (prev.pos + entry.pos) / 2 : Math.max(minStart, entry.pos - half),
            end: next ? (entry.pos + next.pos) / 2 : entry.pos + half
          };
        });
      const rowBounds = bounds(rowAxis, 10, gridTop);
      const colBounds = bounds(colAxis, 25, gridLeft);

      const cells = new Map<string, SheetTextItem[]>();
      for (const item of inside) {
        if (item.y <= gridTop) continue;
        const text = clean(item.str);
        if (parseTimeLabel(text) !== null) continue;
        if (COURT_HEADER.test(text) && text.length <= 32 && !matchers.some((m) => m.re.test(text)) && !COACH_PREFIX.test(text)) continue;
        const cx = centerX(item);
        const col = colBounds.find((c) => cx >= c.start && cx < c.end);
        const row = rowBounds.find((r) => item.y >= r.start && item.y < r.end);
        if (!col || !row) continue;
        const hour = rowIsTime ? row.key : col.key;
        const court = rowIsTime ? col.key : row.key;
        const key = `${hour}|${court}`;
        cells.set(key, [...(cells.get(key) ?? []), item]);
      }

      for (const [key, cellItems] of cells) {
        const [hourText, court] = key.split("|");
        const lines = cellItems
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((i) => clean(i.str))
          .filter(Boolean);
        const cell = readCell(lines, matchers);
        if (!cell) continue;
        slots.push({ date: block.date, hour: Number(hourText), court, coach: cell.coach, student: cell.student });
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
