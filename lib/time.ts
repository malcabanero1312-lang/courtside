function partsInZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isValidTimeInput(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = offsetMs(new Date(guess), timeZone);
  let utc = guess - firstOffset;
  const secondOffset = offsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) {
    utc = guess - secondOffset;
  }
  return new Date(utc);
}

export function utcToZonedInputs(iso: string, timeZone: string): { date: string; time: string } {
  const p = partsInZone(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`
  };
}

export function todayInZone(timeZone: string): string {
  return utcToZonedInputs(new Date().toISOString(), timeZone).date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function startOfWeek(date: string): string {
  const day = weekdayOf(date);
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

export function dayRangeUtc(date: string, timeZone: string): { start: string; end: string } {
  return {
    start: zonedToUtc(date, "00:00", timeZone).toISOString(),
    end: zonedToUtc(addDays(date, 1), "00:00", timeZone).toISOString()
  };
}
