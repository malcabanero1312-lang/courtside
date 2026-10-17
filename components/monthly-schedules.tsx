"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { confirmMonthlyByStaff, markOfficeSent, sendMonthly } from "@/app/(app)/regulars/actions";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  buildMonthlyStudentMessage,
  buildOfficeMessage,
  groupEntries,
  monthDates,
  monthName,
  time12,
  timeRange12,
  weekdayOfDate,
  type RequestEntry
} from "@/lib/regular";

export interface MonthlySlot {
  id: string;
  studentId: string;
  weekday: number;
  start: string;
  end: string;
}

export interface MonthlyStudent {
  id: string;
  name: string;
  phone: string | null;
  venueId: string | null;
}

export interface MonthlyVenue {
  id: string;
  name: string;
  color: string;
}

export interface MonthlyRecord {
  id: string;
  studentId: string;
  status: "sent" | "confirmed" | "change_requested" | "declined";
  entries: RequestEntry[];
  requestedEntries: RequestEntry[] | null;
  note: string | null;
  token: string;
  answeredBy: string | null;
  sentAt: string;
  officeSentAt: string | null;
}

interface GroupState {
  key: string;
  weekday: number;
  start: string;
  end: string;
  usualStart: string | null;
  usualEnd: string | null;
  dates: { date: string; on: boolean }[];
}

type StatusKey = MonthlyRecord["status"] | "none";
type Filter = "all" | StatusKey;

const STATUS_META: Record<StatusKey, { label: string; tone: string }> = {
  none: { label: "Not sent yet", tone: "slate" },
  sent: { label: "Waiting for answer", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  change_requested: { label: "Wants a change", tone: "violet" },
  declined: { label: "Not continuing", tone: "muted" }
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let text = "";
  bytes.forEach((b) => (text += String.fromCharCode(b)));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function letterOf(name: string): string {
  const ch = name.trim()[0]?.toUpperCase() ?? "#";
  return /[A-Z]/.test(ch) ? ch : "#";
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

function buildGroups(slots: MonthlySlot[], month: string, saved: RequestEntry[] | null): GroupState[] {
  const used = new Set<string>();
  const groups: GroupState[] = slots
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
    .map((slot) => {
      const dates = monthDates(month, slot.weekday);
      const mine = saved ? saved.filter((e) => dates.includes(e.date) && !used.has(`${e.date}|${e.start}`)) : [];
      const exact = mine.filter((e) => e.start === slot.start);
      const pool = (exact.length ? exact : mine).filter((e, i, arr) => arr.findIndex((x) => x.date === e.date) === i);
      pool.forEach((e) => used.add(`${e.date}|${e.start}`));
      return {
        key: slot.id,
        weekday: slot.weekday,
        start: pool[0]?.start ?? slot.start,
        end: pool[0]?.end ?? slot.end,
        usualStart: slot.start,
        usualEnd: slot.end,
        dates: dates.map((date) => ({ date, on: saved ? pool.some((e) => e.date === date) : true }))
      };
    });
  const leftovers = saved ? saved.filter((e) => !used.has(`${e.date}|${e.start}`)) : [];
  for (const e of leftovers) addDateTo(groups, month, e);
  return groups;
}

function addDateTo(groups: GroupState[], month: string, entry: RequestEntry): GroupState[] {
  const weekday = weekdayOfDate(entry.date);
  const existing = groups.find((g) => g.weekday === weekday && g.start === entry.start && g.end === entry.end);
  if (existing) {
    existing.dates = existing.dates.map((d) => (d.date === entry.date ? { ...d, on: true } : d));
    if (!existing.dates.some((d) => d.date === entry.date)) {
      existing.dates = [...existing.dates, { date: entry.date, on: true }].sort((a, b) => a.date.localeCompare(b.date));
    }
    return groups;
  }
  groups.push({
    key: `custom-${weekday}-${entry.start}-${entry.end}`,
    weekday,
    start: entry.start,
    end: entry.end,
    usualStart: null,
    usualEnd: null,
    dates: monthDates(month, weekday).map((date) => ({ date, on: date === entry.date }))
  });
  return groups;
}

function groupsToEntries(groups: GroupState[]): RequestEntry[] {
  const seen = new Set<string>();
  const out: RequestEntry[] = [];
  for (const g of groups) {
    for (const d of g.dates) {
      if (!d.on) continue;
      const key = `${d.date}|${g.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ date: d.date, start: g.start, end: g.end });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function cloneGroups(groups: GroupState[]): GroupState[] {
  return groups.map((g) => ({ ...g, dates: g.dates.map((d) => ({ ...d })) }));
}

export function MonthlySchedules({
  month,
  coachId,
  venues,
  students,
  slots,
  records,
  officePhone
}: {
  month: string;
  coachId: string;
  venues: MonthlyVenue[];
  students: MonthlyStudent[];
  slots: MonthlySlot[];
  records: MonthlyRecord[];
  officePhone: string | null;
}) {
  const router = useRouter();
  const recordFor = useMemo(() => new Map(records.map((r) => [r.studentId, r])), [records]);
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  const [fallbackVenue, setFallbackVenue] = useState(venues[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, GroupState[]>>(() =>
    Object.fromEntries(
      students.map((s) => {
        const record = recordFor.get(s.id);
        const saved = record ? record.requestedEntries ?? record.entries : null;
        return [s.id, buildGroups(slots.filter((x) => x.studentId === s.id), month, saved)];
      })
    )
  );
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [onlyNew, setOnlyNew] = useState(true);
  const [officeCopied, setOfficeCopied] = useState(false);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Record<string, { mode: "date" | "day"; date: string; weekday: number; start: string; end: string } | null>>({});
  const [, startTransition] = useTransition();

  const statusOf = (id: string): StatusKey => recordFor.get(id)?.status ?? "none";
  const counts: Record<StatusKey, number> = {
    none: students.filter((s) => !recordFor.get(s.id)).length,
    sent: records.filter((r) => r.status === "sent").length,
    change_requested: records.filter((r) => r.status === "change_requested").length,
    confirmed: records.filter((r) => r.status === "confirmed").length,
    declined: records.filter((r) => r.status === "declined").length
  };

  const visible = students.filter(
    (s) => (filter === "all" || statusOf(s.id) === filter) && (!search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const firstForLetter = new Map<string, string>();
  visible.forEach((s) => {
    const l = letterOf(s.name);
    if (!firstForLetter.has(l)) firstForLetter.set(l, s.id);
  });

  const confirmed = records.filter((r) => r.status === "confirmed");
  const notYetToOffice = confirmed.filter((r) => !r.officeSentAt);
  const showingOnlyNew = onlyNew && notYetToOffice.length > 0 && notYetToOffice.length < confirmed.length;
  const officeList = showingOnlyNew ? notYetToOffice : confirmed;
  const officeMessage = buildOfficeMessage(
    students
      .filter((s) => officeList.some((r) => r.studentId === s.id))
      .map((s) => ({ name: s.name, entries: officeList.find((r) => r.studentId === s.id)?.entries ?? [] }))
  );
  const studentsWithoutVenue = students.some((s) => !s.venueId);

  const updateGroups = (id: string, change: (groups: GroupState[]) => GroupState[]) =>
    setDrafts((current) => ({ ...current, [id]: change(cloneGroups(current[id] ?? [])) }));

  const copyText = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => window.prompt("Copy this message", text));
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  };

  const flashCopied = (id: string) => {
    setCopiedFor(id);
    window.setTimeout(() => setCopiedFor((current) => (current === id ? null : current)), 1800);
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const send = (student: MonthlyStudent, mode: "whatsapp" | "copy") => {
    const existing = recordFor.get(student.id);
    const entries = groupsToEntries(drafts[student.id] ?? []);
    const venueId = student.venueId ?? fallbackVenue;
    if (!entries.length) {
      setErrors((e) => ({ ...e, [student.id]: "Add at least one date." }));
      return;
    }
    if (!venueId) {
      setErrors((e) => ({ ...e, [student.id]: "Choose the venue at the top first." }));
      return;
    }
    const token = existing?.token ?? newToken();
    const text = buildMonthlyStudentMessage(student.name.split(" ")[0], month, entries, `${window.location.origin}/m/${token}`);
    if (mode === "whatsapp") {
      openWhatsApp(student.phone, text);
    } else {
      copyText(text);
      flashCopied(student.id);
    }
    setBusy(student.id);
    setErrors((e) => ({ ...e, [student.id]: "" }));
    startTransition(async () => {
      const res = await sendMonthly({ month, coachId, venueId, studentId: student.id, token, entries });
      setBusy(null);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [student.id]: res.error ?? "Couldn't save." }));
        return;
      }
      setEditing((e) => ({ ...e, [student.id]: false }));
      router.refresh();
    });
  };

  const resendSame = (student: MonthlyStudent, record: MonthlyRecord, mode: "whatsapp" | "copy") => {
    const text = buildMonthlyStudentMessage(
      student.name.split(" ")[0],
      month,
      record.requestedEntries ?? record.entries,
      `${window.location.origin}/m/${record.token}`
    );
    if (mode === "whatsapp") {
      openWhatsApp(student.phone, text);
    } else {
      copyText(text);
      flashCopied(student.id);
    }
  };

  const markConfirmed = (student: MonthlyStudent) => {
    const existing = recordFor.get(student.id);
    if (!existing) return;
    setBusy(student.id);
    startTransition(async () => {
      const res = await confirmMonthlyByStaff(existing.id);
      setBusy(null);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [student.id]: res.error ?? "Couldn't save." }));
        return;
      }
      router.refresh();
    });
  };

  const sendOffice = (mode: "whatsapp" | "copy") => {
    if (!officeMessage) return;
    if (mode === "whatsapp") {
      openWhatsApp(officePhone, officeMessage);
    } else {
      copyText(officeMessage);
      setOfficeCopied(true);
      window.setTimeout(() => setOfficeCopied(false), 1800);
    }
    startTransition(async () => {
      await markOfficeSent(officeList.map((r) => r.id));
      router.refresh();
    });
  };

  const commitAdd = (studentId: string) => {
    const form = adding[studentId];
    if (!form) return;
    if (!form.start || !form.end || form.end <= form.start) {
      setErrors((e) => ({ ...e, [studentId]: "The end time must be after the start time." }));
      return;
    }
    if (form.mode === "date") {
      if (!form.date || !form.date.startsWith(month)) {
        setErrors((e) => ({ ...e, [studentId]: `Pick a date in ${monthName(month)}.` }));
        return;
      }
      updateGroups(studentId, (groups) => addDateTo(groups, month, { date: form.date, start: form.start, end: form.end }));
    } else {
      updateGroups(studentId, (groups) => {
        const existing = groups.find((g) => g.weekday === form.weekday && g.start === form.start && g.end === form.end);
        if (existing) {
          existing.dates = existing.dates.map((d) => ({ ...d, on: true }));
          return groups;
        }
        return [
          ...groups,
          {
            key: `custom-${form.weekday}-${form.start}-${form.end}`,
            weekday: form.weekday,
            start: form.start,
            end: form.end,
            usualStart: null,
            usualEnd: null,
            dates: monthDates(month, form.weekday).map((date) => ({ date, on: true }))
          }
        ];
      });
    }
    setErrors((e) => ({ ...e, [studentId]: "" }));
    setAdding((a) => ({ ...a, [studentId]: null }));
  };

  if (students.length === 0) {
    return (
      <div className="card card-pad stack">
        <div className="card-title">No regular students yet</div>
        <p className="small muted" style={{ margin: 0 }}>
          Import the office sheet for a month the students already confirmed (like October). Courtside saves each student's weekly
          schedule from it, and they'll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid main-side ms-layout">
      <div className="stack">
        <section className="card card-pad stack ms-summary">
          <div className="row between wrap" style={{ gap: 8 }}>
            <strong>{monthName(month)} · {students.length} regular student{students.length === 1 ? "" : "s"}</strong>
            <button type="button" className="btn small primary" onClick={() => scrollTo("office-message")}>
              <Icon name="send" size={14} /> Office message ({confirmed.length})
            </button>
          </div>
          <div className="ms-filters" role="tablist" aria-label="Filter students">
            <button type="button" className={`ms-filter ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
              All <span>{students.length}</span>
            </button>
            {(["none", "sent", "change_requested", "confirmed", "declined"] as StatusKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`ms-filter tone-${STATUS_META[key].tone} ${filter === key ? "on" : ""}`}
                onClick={() => setFilter(filter === key ? "all" : key)}
              >
                {STATUS_META[key].label} <span>{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <input
              className="input ms-search"
              type="search"
              placeholder="Search students…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
            {studentsWithoutVenue && venues.length > 1 ? (
              <select className="input ms-venue-select" value={fallbackVenue} onChange={(e) => setFallbackVenue(e.target.value)} aria-label="Venue for students without one">
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    Venue if not set: {v.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <span className="small muted">
            Send each student their {monthName(month)} schedule. On their link every date is ticked — they untick any they can't make and
            confirm. Confirmed students go straight into the office message.
          </span>
        </section>

        {visible.length === 0 ? <div className="card card-pad small muted">No students match.</div> : null}

        {visible.map((student) => {
          const record = recordFor.get(student.id);
          const status = statusOf(student.id);
          const meta = STATUS_META[status];
          const groups = drafts[student.id] ?? [];
          const locked = Boolean(record && (record.status === "confirmed" || record.status === "sent" || record.status === "declined") && !editing[student.id]);
          const venue = venueById.get(student.venueId ?? "") ?? null;
          const requested = record ? record.requestedEntries ?? record.entries : [];
          const confirmedDates = new Set(record && record.status === "confirmed" ? record.entries.map((e) => `${e.date}|${e.start}`) : []);
          const lockedGroups = groupEntries(requested);
          const count = locked ? (record?.status === "confirmed" ? record.entries.length : requested.length) : groupsToEntries(groups).length;
          const add = adding[student.id];
          const letter = letterOf(student.name);
          return (
            <section
              key={student.id}
              id={firstForLetter.get(letter) === student.id ? `letter-${letter}` : undefined}
              className={`card ms-card status-${status}`}
            >
              <div className="ms-head">
                <span className="ms-avatar" style={{ background: venue?.color ?? "var(--court-2)" }} aria-hidden>
                  {initials(student.name)}
                </span>
                <div className="ms-who">
                  <div className="ms-name">{student.name}</div>
                  <div className="ms-meta">
                    {venue ? (
                      <span className="ms-venue" style={{ color: venue.color, borderColor: venue.color }}>
                        <span className="venue-dot" style={{ background: venue.color }} /> {venue.name}
                      </span>
                    ) : (
                      <span className="ms-venue faint">No venue</span>
                    )}
                    <span className="small muted">
                      {count} date{count === 1 ? "" : "s"}
                      {record?.status === "confirmed" && record.entries.length < requested.length ? ` of ${requested.length}` : ""}
                    </span>
                    {!student.phone ? <span className="small faint">· no WhatsApp</span> : null}
                  </div>
                </div>
                <span className={`badge plain tone-${meta.tone} ms-status`}>
                  {status === "confirmed" && record?.answeredBy === "staff" ? "Confirmed (by you)" : meta.label}
                  {status === "confirmed" && record?.officeSentAt ? " · sent to office" : ""}
                </span>
              </div>

              {record?.status === "change_requested" && record.note ? (
                <div className="notice info ms-note">
                  <Icon name="info" size={17} />
                  <div>
                    <strong>{student.name.split(" ")[0]} wrote:</strong> “{record.note}” — adjust below, then send the updated schedule or mark it confirmed.
                  </div>
                </div>
              ) : null}

              <div className="ms-body">
                {locked ? (
                  lockedGroups.map((g) => (
                    <div key={`${g.weekday}-${g.start}`} className="req-group">
                      <div className="req-group-head">
                        <strong>{WEEKDAY_NAMES[g.weekday]}s</strong>
                        <span className="small muted">{timeRange12(g.start, g.end)}</span>
                      </div>
                      <div className="req-dates">
                        {g.dates.map((date) => {
                          const skipped = record?.status === "confirmed" && !confirmedDates.has(`${date}|${g.start}`);
                          const declined = record?.status === "declined";
                          return (
                            <span
                              key={date}
                              className={`req-date ${skipped || declined ? "" : "on"} ${record?.status === "confirmed" && !skipped ? "r-matched" : ""}`}
                              title={skipped ? "The student unticked this date" : undefined}
                            >
                              {Number(date.slice(8, 10))}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    {groups.map((g) => {
                      const changed = g.usualStart !== null && (g.start !== g.usualStart || g.end !== g.usualEnd);
                      return (
                        <div key={g.key} className={`req-group ${g.usualStart === null ? "custom" : ""}`}>
                          <div className="req-group-head">
                            <strong>{WEEKDAY_NAMES[g.weekday]}s</strong>
                            <div className="req-times">
                              <input
                                className="input"
                                type="time"
                                value={g.start}
                                aria-label="Start"
                                onChange={(e) =>
                                  updateGroups(student.id, (list) => list.map((y) => (y.key === g.key ? { ...y, start: e.target.value } : y)))
                                }
                              />
                              <span className="small muted">to</span>
                              <input
                                className="input"
                                type="time"
                                value={g.end}
                                aria-label="End"
                                onChange={(e) =>
                                  updateGroups(student.id, (list) => list.map((y) => (y.key === g.key ? { ...y, end: e.target.value } : y)))
                                }
                              />
                            </div>
                            {changed ? (
                              <button
                                type="button"
                                className="badge plain tone-amber import-regular"
                                onClick={() =>
                                  updateGroups(student.id, (list) =>
                                    list.map((y) => (y.key === g.key ? { ...y, start: y.usualStart ?? y.start, end: y.usualEnd ?? y.end } : y))
                                  )
                                }
                              >
                                Changed · usual {time12(g.usualStart ?? g.start)} ✕
                              </button>
                            ) : null}
                            {g.usualStart === null ? (
                              <>
                                <span className="badge plain tone-violet">Added</span>
                                <button
                                  type="button"
                                  className="btn small ghost ms-remove"
                                  aria-label="Remove this day"
                                  onClick={() => updateGroups(student.id, (list) => list.filter((y) => y.key !== g.key))}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              </>
                            ) : null}
                          </div>
                          <div className="req-dates">
                            {g.dates.map((d) => (
                              <button
                                key={d.date}
                                type="button"
                                className={`req-date ${d.on ? "on" : ""}`}
                                title={d.on ? "Tap to skip this date" : "Tap to include this date"}
                                onClick={() =>
                                  updateGroups(student.id, (list) =>
                                    list.map((y) =>
                                      y.key === g.key ? { ...y, dates: y.dates.map((z) => (z.date === d.date ? { ...z, on: !z.on } : z)) } : y
                                    )
                                  )
                                }
                              >
                                {Number(d.date.slice(8, 10))}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {add ? (
                      <div className="ms-add anim-in">
                        <div className="ms-add-tabs">
                          <button
                            type="button"
                            className={`ms-filter ${add.mode === "date" ? "on" : ""}`}
                            onClick={() => setAdding((a) => ({ ...a, [student.id]: { ...add, mode: "date" } }))}
                          >
                            One date
                          </button>
                          <button
                            type="button"
                            className={`ms-filter ${add.mode === "day" ? "on" : ""}`}
                            onClick={() => setAdding((a) => ({ ...a, [student.id]: { ...add, mode: "day" } }))}
                          >
                            Every week
                          </button>
                        </div>
                        <div className="ms-add-fields">
                          {add.mode === "date" ? (
                            <label className="field">
                              <span>Date</span>
                              <input
                                className="input"
                                type="date"
                                min={`${month}-01`}
                                max={lastDayOf(month)}
                                value={add.date}
                                onChange={(e) => setAdding((a) => ({ ...a, [student.id]: { ...add, date: e.target.value } }))}
                              />
                            </label>
                          ) : (
                            <label className="field">
                              <span>Day</span>
                              <select
                                className="input"
                                value={add.weekday}
                                onChange={(e) => setAdding((a) => ({ ...a, [student.id]: { ...add, weekday: Number(e.target.value) } }))}
                              >
                                {WEEKDAY_NAMES.map((d, i) => (
                                  <option key={d} value={i}>
                                    Every {d}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label className="field">
                            <span>From</span>
                            <input
                              className="input"
                              type="time"
                              value={add.start}
                              onChange={(e) => setAdding((a) => ({ ...a, [student.id]: { ...add, start: e.target.value } }))}
                            />
                          </label>
                          <label className="field">
                            <span>Until</span>
                            <input
                              className="input"
                              type="time"
                              value={add.end}
                              onChange={(e) => setAdding((a) => ({ ...a, [student.id]: { ...add, end: e.target.value } }))}
                            />
                          </label>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <button type="button" className="btn small primary" onClick={() => commitAdd(student.id)}>
                            <Icon name="plus" size={14} /> {add.mode === "date" ? "Add date" : `Add every ${WEEKDAY_SHORT[add.weekday]}`}
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => setAdding((a) => ({ ...a, [student.id]: null }))}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn small ghost ms-add-open"
                        onClick={() => {
                          const first = groups[0];
                          setAdding((a) => ({
                            ...a,
                            [student.id]: {
                              mode: "date",
                              date: "",
                              weekday: first?.weekday ?? 0,
                              start: first?.start ?? "12:00",
                              end: first?.end ?? "13:00"
                            }
                          }));
                        }}
                      >
                        <Icon name="plus" size={14} /> Add a date or day
                      </button>
                    )}
                  </>
                )}

                {errors[student.id] ? <span className="small ms-error">{errors[student.id]}</span> : null}

                <div className="ms-actions">
                  {!record || !locked ? (
                    <>
                      <button type="button" className="btn small whatsapp" disabled={busy === student.id} onClick={() => send(student, "whatsapp")}>
                        <Icon name="whatsapp" size={15} /> {record ? "Send updated" : "Send to student"}
                      </button>
                      <button type="button" className="btn small" disabled={busy === student.id} onClick={() => send(student, "copy")}>
                        <Icon name={copiedFor === student.id ? "check" : "copy"} size={14} /> {copiedFor === student.id ? "Copied" : "Copy message"}
                      </button>
                    </>
                  ) : null}
                  {record && locked && record.status === "sent" ? (
                    <>
                      <button type="button" className="btn small whatsapp" onClick={() => resendSame(student, record, "whatsapp")}>
                        <Icon name="whatsapp" size={15} /> Send again
                      </button>
                      <button type="button" className="btn small" onClick={() => resendSame(student, record, "copy")}>
                        <Icon name={copiedFor === student.id ? "check" : "copy"} size={14} /> {copiedFor === student.id ? "Copied" : "Copy message"}
                      </button>
                    </>
                  ) : null}
                  {record && (record.status === "sent" || record.status === "change_requested") ? (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy === student.id}
                      onClick={() => markConfirmed(student)}
                      title="The student confirmed by chat or phone"
                    >
                      <Icon name="check" size={14} /> Mark confirmed
                    </button>
                  ) : null}
                  {record && locked ? (
                    <button type="button" className="btn small ghost" onClick={() => setEditing((e) => ({ ...e, [student.id]: true }))}>
                      Change schedule
                    </button>
                  ) : null}
                  {record && !locked && editing[student.id] ? (
                    <button type="button" className="btn small ghost" onClick={() => setEditing((e) => ({ ...e, [student.id]: false }))}>
                      Cancel
                    </button>
                  ) : null}
                </div>
                {record && !locked && record.status === "confirmed" ? (
                  <span className="small faint">Sending an updated schedule asks the student to confirm again and removes this month's waiting sessions.</span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <aside className="stack req-aside" id="office-message">
        <section className="card card-pad stack">
          <div className="row between">
            <div className="card-title">Message to the office</div>
            <span className="small muted">{officeList.length} confirmed</span>
          </div>
          {notYetToOffice.length > 0 && notYetToOffice.length < confirmed.length ? (
            <label className="check small">
              <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
              Only students not sent to the office yet ({notYetToOffice.length})
            </label>
          ) : null}
          <textarea
            className="input wa-preview req-message"
            readOnly
            value={officeMessage || "No confirmed students yet. They appear here as soon as they confirm."}
          />
          <div className="row wrap">
            <button type="button" className="btn whatsapp" disabled={!officeMessage} onClick={() => sendOffice("whatsapp")}>
              <Icon name="whatsapp" size={17} /> Send to office
            </button>
            <button type="button" className="btn" disabled={!officeMessage} onClick={() => sendOffice("copy")}>
              <Icon name={officeCopied ? "check" : "copy"} size={15} /> {officeCopied ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="small muted">
            {counts.sent + counts.none > 0
              ? `${counts.sent + counts.none} student${counts.sent + counts.none === 1 ? " hasn't" : "s haven't"} confirmed yet — you can send now and the rest later.`
              : "Everyone has answered."}{" "}
            When the office replies with the PDF, import it and Courtside confirms everyone automatically.
          </span>
          {!officePhone ? <span className="small faint">Tip: add the office's WhatsApp number in Settings to open their chat directly.</span> : null}
          <button type="button" className="btn small ghost" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            ↑ Back to top
          </button>
        </section>
      </aside>

      {students.length > 6 ? (
        <nav className="ms-index" aria-label="Jump to letter">
          {LETTERS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={!firstForLetter.has(l)}
              onClick={() => scrollTo(`letter-${l}`)}
              aria-label={`Students starting with ${l}`}
            >
              {l}
            </button>
          ))}
        </nav>
      ) : null}

      <button type="button" className="ms-fab" onClick={() => scrollTo("office-message")}>
        <Icon name="send" size={16} /> Office message
        {confirmed.length ? <span className="ms-fab-count">{confirmed.length}</span> : null}
      </button>
    </div>
  );
}
