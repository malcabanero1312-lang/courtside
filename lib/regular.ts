export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export interface RequestEntry {
  date: string;
  start: string;
  end: string;
}

export interface EntryGroup {
  weekday: number;
  start: string;
  end: string;
  dates: string[];
}

export function weekdayOfDate(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function time12(time: string): string {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function timeRange12(start: string, end: string): string {
  return `${time12(start)} - ${time12(end)}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

export function monthName(month: string): string {
  return MONTH_LONG[Number(month.split("-")[1]) - 1];
}

export function monthDates(month: string, weekday: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates: string[] = [];
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (weekdayOfDate(date) === weekday) dates.push(date);
  }
  return dates;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function groupEntries(entries: RequestEntry[]): EntryGroup[] {
  const map = new Map<string, EntryGroup>();
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))) {
    const weekday = weekdayOfDate(e.date);
    const key = `${weekday}|${e.start}|${e.end}`;
    const group = map.get(key) ?? { weekday, start: e.start, end: e.end, dates: [] };
    group.dates.push(e.date);
    map.set(key, group);
  }
  return Array.from(map.values()).sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
}

export function datesLine(dates: string[]): string {
  const parts: string[] = [];
  let lastMonth = -1;
  for (const date of dates) {
    const month = Number(date.slice(5, 7)) - 1;
    const day = Number(date.slice(8, 10));
    parts.push(month === lastMonth ? String(day) : `${MONTH_SHORT[month]} ${day}`);
    lastMonth = month;
  }
  return parts.join(", ");
}

export function groupHeading(group: EntryGroup): string {
  const name = WEEKDAY_NAMES[group.weekday];
  return `${group.dates.length > 1 ? `${name}s` : name} (${timeRange12(group.start, group.end)})`;
}

export function buildOfficeMessage(students: { name: string; entries: RequestEntry[] }[]): string {
  return students
    .filter((s) => s.entries.length)
    .map((s) => [s.name, ...groupEntries(s.entries).flatMap((g) => [groupHeading(g), datesLine(g.dates)])].join("\n"))
    .join("\n\n");
}

export function buildStudentAskMessage(firstName: string, month: string, entries: RequestEntry[]): string {
  const lines = groupEntries(entries).flatMap((g) => [groupHeading(g), datesLine(g.dates)]);
  return [
    `Hi ${firstName || "there"}! Here's your tennis schedule for ${monthName(month)}:`,
    "",
    ...lines,
    "",
    "Are you continuing with this schedule? Let me know if you'd like to change any day or time so I can request it from the office."
  ].join("\n");
}

export function buildMissingMessage(firstName: string, entries: RequestEntry[]): string {
  const lines = groupEntries(entries).flatMap((g) => [groupHeading(g), datesLine(g.dates)]);
  return [
    `Hi ${firstName || "there"}! The office couldn't give us your usual court for:`,
    "",
    ...lines,
    "",
    "I'll check other available times for you. Let me know if there's a time that works best."
  ].join("\n");
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xf = x.split(" ")[0];
  const yf = y.split(" ")[0];
  if (x.split(" ").length === 1 || y.split(" ").length === 1) return xf === yf;
  return false;
}
