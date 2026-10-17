"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { saveOfficeRequest } from "@/app/(app)/regulars/actions";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  WEEKDAY_NAMES,
  buildOfficeMessage,
  buildStudentAskMessage,
  monthDates,
  monthName,
  time12,
  type RequestEntry
} from "@/lib/regular";

export interface BuilderSlot {
  id: string;
  studentId: string;
  weekday: number;
  start: string;
  end: string;
}

export interface BuilderStudent {
  id: string;
  name: string;
  phone: string | null;
}

export interface SavedItem {
  studentId: string;
  date: string;
  start: string;
  end: string;
  result: "pending" | "matched" | "changed" | "missing";
}

interface GroupState {
  key: string;
  weekday: number;
  start: string;
  end: string;
  usualStart: string;
  usualEnd: string;
  dates: { date: string; on: boolean }[];
}

interface StudentState {
  include: boolean;
  groups: GroupState[];
  extras: RequestEntry[];
}

const RESULT_META: Record<SavedItem["result"], { label: string; tone: string }> = {
  pending: { label: "Waiting for office", tone: "slate" },
  matched: { label: "Office confirmed", tone: "green" },
  changed: { label: "Office changed time", tone: "amber" },
  missing: { label: "Not on office sheet", tone: "red" }
};

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

function initialState(students: BuilderStudent[], slots: BuilderSlot[], saved: SavedItem[], month: string): Record<string, StudentState> {
  const hasSaved = saved.length > 0;
  const state: Record<string, StudentState> = {};
  for (const student of students) {
    const mine = saved.filter((s) => s.studentId === student.id);
    const used = new Set<string>();
    const groups: GroupState[] = slots
      .filter((slot) => slot.studentId === student.id)
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
      .map((slot) => {
        const dates = monthDates(month, slot.weekday);
        const candidates = mine.filter((m) => dates.includes(m.date) && !used.has(`${m.date}|${m.start}`));
        const exact = candidates.filter((m) => m.start === slot.start);
        const pool = exact.length ? exact : candidates.filter((m) => !slots.some((o) => o.studentId === student.id && o.id !== slot.id && o.weekday === slot.weekday && o.start === m.start));
        const savedHere = pool.filter((m, i) => pool.findIndex((n) => n.date === m.date) === i);
        const first = savedHere[0];
        savedHere.forEach((m) => used.add(`${m.date}|${m.start}`));
        return {
          key: slot.id,
          weekday: slot.weekday,
          start: first?.start ?? slot.start,
          end: first?.end ?? slot.end,
          usualStart: slot.start,
          usualEnd: slot.end,
          dates: dates.map((date) => ({ date, on: hasSaved ? savedHere.some((m) => m.date === date) : true }))
        };
      });
    const extras = mine.filter((m) => !used.has(`${m.date}|${m.start}`)).map((m) => ({ date: m.date, start: m.start, end: m.end }));
    state[student.id] = { include: hasSaved ? mine.length > 0 : true, groups, extras };
  }
  return state;
}

function entriesOf(s: StudentState | undefined): RequestEntry[] {
  if (!s || !s.include) return [];
  return [
    ...s.groups.flatMap((g) => g.dates.filter((d) => d.on).map((d) => ({ date: d.date, start: g.start, end: g.end }))),
    ...s.extras
  ];
}

export function OfficeRequestBuilder({
  month,
  coachId,
  students,
  slots,
  saved,
  savedAt,
  officePhone
}: {
  month: string;
  coachId: string;
  students: BuilderStudent[];
  slots: BuilderSlot[];
  saved: SavedItem[];
  savedAt: string | null;
  officePhone: string | null;
  timezone: string;
}) {
  const [state, setState] = useState<Record<string, StudentState>>(() => initialState(students, slots, saved, month));
  const [lastSaved, setLastSaved] = useState<string | null>(savedAt);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, startSaving] = useTransition();
  const [extraDraft, setExtraDraft] = useState<Record<string, RequestEntry>>({});

  const resultFor = useMemo(() => {
    const map = new Map<string, SavedItem["result"]>();
    saved.forEach((s) => map.set(`${s.studentId}|${s.date}`, s.result));
    return map;
  }, [saved]);

  const message = useMemo(
    () => buildOfficeMessage(students.map((s) => ({ name: s.name, entries: entriesOf(state[s.id]) }))),
    [students, state]
  );
  const included = students.filter((s) => entriesOf(state[s.id]).length > 0);

  const setDraft = (id: string, change: Partial<RequestEntry>) =>
    setExtraDraft((d) => ({ ...d, [id]: { ...{ date: "", start: "12:00", end: "13:00" }, ...d[id], ...change } }));

  const update = (id: string, change: (s: StudentState) => StudentState) => setState((current) => ({ ...current, [id]: change(current[id]) }));

  const save = () =>
    new Promise<boolean>((resolve) => {
      setError(null);
      startSaving(async () => {
        const res = await saveOfficeRequest({
          month,
          coachId,
          message,
          students: students.map((s) => ({ studentId: s.id, entries: entriesOf(state[s.id]) }))
        });
        if (!res.ok) {
          setError(res.error ?? "Couldn't save.");
          resolve(false);
          return;
        }
        setLastSaved(res.savedAt ?? new Date().toISOString());
        resolve(true);
      });
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const area = document.createElement("textarea");
      area.value = message;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    await save();
  };

  if (students.length === 0) {
    return (
      <div className="card card-pad stack">
        <div className="card-title">No weekly schedules yet</div>
        <p className="small muted" style={{ margin: 0 }}>
          Add each regular student's fixed days and times on their page, or use “Find weekly schedules from bookings” below to fill them in
          from the sheet you already imported.
        </p>
      </div>
    );
  }

  return (
    <div className="grid main-side">
      <div className="stack">
        {students.map((student) => {
          const s = state[student.id];
          const entries = entriesOf(s);
          const first = student.name.split(" ")[0];
          return (
            <section key={student.id} className={`card req-student ${s.include ? "" : "off"}`}>
              <div className="req-head">
                <label className="check">
                  <input type="checkbox" checked={s.include} onChange={(e) => update(student.id, (x) => ({ ...x, include: e.target.checked }))} />
                  <strong>{student.name}</strong>
                </label>
                <span className="small muted">{s.include ? `${entries.length} date${entries.length === 1 ? "" : "s"}` : "Not continuing"}</span>
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={!entries.length}
                  title="Ask the student if they're continuing"
                  onClick={() => openWhatsApp(student.phone, buildStudentAskMessage(first, month, entries))}
                >
                  <Icon name="whatsapp" size={15} /> Ask student
                </button>
              </div>

              {s.include ? (
                <div className="req-body">
                  {s.groups.map((g) => {
                    const changed = g.start !== g.usualStart || g.end !== g.usualEnd;
                    return (
                      <div key={g.key} className="req-group">
                        <div className="req-group-head">
                          <strong>{WEEKDAY_NAMES[g.weekday]}s</strong>
                          <div className="req-times">
                            <input
                              className="input"
                              type="time"
                              value={g.start}
                              aria-label="Start"
                              onChange={(e) =>
                                update(student.id, (x) => ({ ...x, groups: x.groups.map((y) => (y.key === g.key ? { ...y, start: e.target.value } : y)) }))
                              }
                            />
                            <span className="small muted">to</span>
                            <input
                              className="input"
                              type="time"
                              value={g.end}
                              aria-label="End"
                              onChange={(e) =>
                                update(student.id, (x) => ({ ...x, groups: x.groups.map((y) => (y.key === g.key ? { ...y, end: e.target.value } : y)) }))
                              }
                            />
                          </div>
                          {changed ? (
                            <button
                              type="button"
                              className="badge plain tone-amber import-regular"
                              title="Back to the usual time"
                              onClick={() =>
                                update(student.id, (x) => ({
                                  ...x,
                                  groups: x.groups.map((y) => (y.key === g.key ? { ...y, start: y.usualStart, end: y.usualEnd } : y))
                                }))
                              }
                            >
                              Changed · usual {time12(g.usualStart)} ✕
                            </button>
                          ) : null}
                        </div>
                        <div className="req-dates">
                          {g.dates.map((d) => {
                            const result = resultFor.get(`${student.id}|${d.date}`);
                            return (
                              <button
                                key={d.date}
                                type="button"
                                className={`req-date ${d.on ? "on" : ""} ${result && result !== "pending" ? `r-${result}` : ""}`}
                                title={result ? RESULT_META[result].label : d.on ? "Tap to skip this date" : "Tap to include this date"}
                                onClick={() =>
                                  update(student.id, (x) => ({
                                    ...x,
                                    groups: x.groups.map((y) =>
                                      y.key === g.key ? { ...y, dates: y.dates.map((z) => (z.date === d.date ? { ...z, on: !z.on } : z)) } : y
                                    )
                                  }))
                                }
                              >
                                {dayNumber(d.date)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {s.extras.map((e, i) => (
                    <div key={`${e.date}-${i}`} className="req-extra small">
                      <span>
                        Extra: <strong>{e.date.slice(8, 10).replace(/^0/, "")} {monthName(month).slice(0, 3)}</strong> · {time12(e.start)} – {time12(e.end)}
                      </span>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() => update(student.id, (x) => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <details className="disclosure">
                    <summary className="btn small ghost">
                      <Icon name="plus" size={14} /> Add a one-off date
                    </summary>
                    <div className="row wrap" style={{ marginTop: 8 }}>
                      <input
                        className="input"
                        type="date"
                        min={`${month}-01`}
                        max={`${month}-31`}
                        value={extraDraft[student.id]?.date ?? ""}
                        onChange={(e) =>
                          setDraft(student.id, { date: e.target.value })
                        }
                        style={{ width: 160 }}
                      />
                      <input
                        className="input"
                        type="time"
                        value={extraDraft[student.id]?.start ?? "12:00"}
                        onChange={(e) =>
                          setDraft(student.id, { start: e.target.value })
                        }
                        style={{ width: 120 }}
                      />
                      <input
                        className="input"
                        type="time"
                        value={extraDraft[student.id]?.end ?? "13:00"}
                        onChange={(e) =>
                          setDraft(student.id, { end: e.target.value })
                        }
                        style={{ width: 120 }}
                      />
                      <button
                        type="button"
                        className="btn small"
                        disabled={!extraDraft[student.id]?.date?.startsWith(month)}
                        onClick={() => {
                          const draft = extraDraft[student.id];
                          if (!draft?.date || draft.end <= draft.start) return;
                          update(student.id, (x) => ({ ...x, extras: [...x.extras, draft] }));
                          setExtraDraft((d) => ({ ...d, [student.id]: { date: "", start: draft.start, end: draft.end } }));
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </details>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <aside className="stack req-aside">
        <section className="card card-pad stack">
          <div className="row between">
            <div className="card-title">Message to the office</div>
            <span className="small muted">{included.length} students</span>
          </div>
          {error ? (
            <div className="notice error" style={{ margin: 0 }}>
              <Icon name="alert" size={17} />
              <div>{error}</div>
            </div>
          ) : null}
          <textarea className="input wa-preview req-message" readOnly value={message || "Tick at least one student."} />
          <div className="row wrap">
            <button
              type="button"
              className="btn whatsapp"
              disabled={!message || saving}
              onClick={async () => {
                openWhatsApp(officePhone, message);
                await save();
              }}
            >
              <Icon name="whatsapp" size={17} /> Send to office
            </button>
            <button type="button" className="btn" disabled={!message || saving} onClick={copy}>
              <Icon name={copied ? "check" : "copy"} size={15} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="small muted">
            {saving
              ? "Saving…"
              : lastSaved
                ? `Saved ${new Date(lastSaved).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. When the office replies, import their PDF — Courtside checks it against this list.`
                : "Sending or copying saves this list, so Courtside can compare it with the office's reply."}
          </span>
          {!officePhone ? <span className="small faint">Tip: add the office's WhatsApp number in Settings to open their chat directly.</span> : null}
          <button type="button" className="btn small ghost" disabled={saving || !message} onClick={() => void save()}>
            Save without sending
          </button>
        </section>
        <section className="card card-pad stack tight small">
          <strong>Date colours</strong>
          <span className="row" style={{ gap: 6 }}>
            <span className="req-date on" aria-hidden>1</span> Requested
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="req-date" aria-hidden>1</span> Skipped
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="req-date on r-matched" aria-hidden>1</span> Office confirmed
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="req-date on r-changed" aria-hidden>1</span> Office changed the time
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="req-date on r-missing" aria-hidden>1</span> Not on the office sheet
          </span>
        </section>
      </aside>
    </div>
  );
}
