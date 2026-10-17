"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { confirmMonthlyByStaff, markOfficeSent, sendMonthly } from "@/app/(app)/regulars/actions";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  WEEKDAY_NAMES,
  buildMonthlyStudentMessage,
  buildOfficeMessage,
  datesLine,
  groupEntries,
  groupHeading,
  monthDates,
  monthName,
  time12,
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
}

export interface MonthlyRecord {
  id: string;
  studentId: string;
  status: "sent" | "confirmed" | "change_requested" | "declined";
  entries: RequestEntry[];
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
  usualStart: string;
  usualEnd: string;
  dates: { date: string; on: boolean }[];
}

interface Draft {
  groups: GroupState[];
  extras: RequestEntry[];
}

const STATUS_META: Record<MonthlyRecord["status"] | "none", { label: string; tone: string }> = {
  none: { label: "Not sent yet", tone: "slate" },
  sent: { label: "Waiting for answer", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  change_requested: { label: "Wants a change", tone: "violet" },
  declined: { label: "Not continuing", tone: "muted" }
};

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let text = "";
  bytes.forEach((b) => (text += String.fromCharCode(b)));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildDraft(slots: MonthlySlot[], month: string, saved: RequestEntry[] | null): Draft {
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
  const extras = saved ? saved.filter((e) => !used.has(`${e.date}|${e.start}`)) : [];
  return { groups, extras };
}

function draftEntries(d: Draft): RequestEntry[] {
  return [...d.groups.flatMap((g) => g.dates.filter((x) => x.on).map((x) => ({ date: x.date, start: g.start, end: g.end }))), ...d.extras];
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
  venues: { id: string; name: string }[];
  students: MonthlyStudent[];
  slots: MonthlySlot[];
  records: MonthlyRecord[];
  officePhone: string | null;
}) {
  const router = useRouter();
  const recordFor = useMemo(() => new Map(records.map((r) => [r.studentId, r])), [records]);
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      students.map((s) => [
        s.id,
        buildDraft(
          slots.filter((x) => x.studentId === s.id),
          month,
          recordFor.get(s.id)?.entries ?? null
        )
      ])
    )
  );
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [onlyNew, setOnlyNew] = useState(true);
  const [officeCopied, setOfficeCopied] = useState(false);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [extraDraft, setExtraDraft] = useState<Record<string, RequestEntry>>({});

  const setDraft = (id: string, change: (d: Draft) => Draft) => setDrafts((current) => ({ ...current, [id]: change(current[id]) }));
  const setExtra = (id: string, change: Partial<RequestEntry>) =>
    setExtraDraft((d) => ({ ...d, [id]: { ...{ date: "", start: "12:00", end: "13:00" }, ...d[id], ...change } }));

  const confirmed = records.filter((r) => r.status === "confirmed");
  const notYetToOffice = confirmed.filter((r) => !r.officeSentAt);
  const officeList = onlyNew && notYetToOffice.length && notYetToOffice.length < confirmed.length ? notYetToOffice : confirmed;
  const officeMessage = buildOfficeMessage(
    students
      .filter((s) => officeList.some((r) => r.studentId === s.id))
      .map((s) => ({ name: s.name, entries: officeList.find((r) => r.studentId === s.id)?.entries ?? [] }))
  );
  const counts = {
    none: students.filter((s) => !recordFor.get(s.id)).length,
    sent: records.filter((r) => r.status === "sent").length,
    change: records.filter((r) => r.status === "change_requested").length,
    confirmed: confirmed.length,
    declined: records.filter((r) => r.status === "declined").length
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  };

  const flashCopied = (id: string) => {
    setCopiedFor(id);
    window.setTimeout(() => setCopiedFor((current) => (current === id ? null : current)), 1800);
  };

  const send = (student: MonthlyStudent, mode: "whatsapp" | "copy" = "whatsapp") => {
    const existing = recordFor.get(student.id);
    const entries = draftEntries(drafts[student.id]);
    if (!entries.length) {
      setErrors((e) => ({ ...e, [student.id]: "Add at least one date." }));
      return;
    }
    if (!venueId) {
      setErrors((e) => ({ ...e, [student.id]: "Choose the venue at the top first." }));
      return;
    }
    const token = existing?.token ?? newToken();
    const link = `${window.location.origin}/m/${token}`;
    const text = buildMonthlyStudentMessage(student.name.split(" ")[0], month, entries, link);
    if (mode === "whatsapp") {
      openWhatsApp(student.phone, text);
    } else {
      void copyText(text);
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

  const copyLinkMessage = async (student: MonthlyStudent) => {
    const existing = recordFor.get(student.id);
    if (!existing) return;
    const link = `${window.location.origin}/m/${existing.token}`;
    await copyText(buildMonthlyStudentMessage(student.name.split(" ")[0], month, existing.entries, link));
    flashCopied(student.id);
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

  const sendOffice = async (mode: "whatsapp" | "copy") => {
    if (!officeMessage) return;
    if (mode === "whatsapp") {
      openWhatsApp(officePhone, officeMessage);
    } else {
      try {
        await navigator.clipboard.writeText(officeMessage);
      } catch {
        window.prompt("Copy this message", officeMessage);
      }
      setOfficeCopied(true);
      window.setTimeout(() => setOfficeCopied(false), 1800);
    }
    startTransition(async () => {
      await markOfficeSent(officeList.map((r) => r.id));
      router.refresh();
    });
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
    <div className="grid main-side">
      <div className="stack">
        <section className="card card-pad stack tight">
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="badge plain tone-slate">{counts.none} not sent</span>
            <span className="badge plain tone-amber">{counts.sent} waiting</span>
            <span className="badge plain tone-violet">{counts.change} want a change</span>
            <span className="badge plain tone-green">{counts.confirmed} confirmed</span>
            <span className="badge plain tone-muted">{counts.declined} not continuing</span>
          </div>
          {venues.length > 1 ? (
            <label className="field" style={{ maxWidth: 320 }}>
              <span>Venue for these lessons</span>
              <select className="input" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="small muted">
            Send each student their {monthName(month)} schedule with a link. When they tap Confirm, they're added to the office message
            and their sessions appear on the calendar as waiting for the office.
          </span>
        </section>

        {students.map((student) => {
          const record = recordFor.get(student.id);
          const status = record?.status ?? "none";
          const meta = STATUS_META[status];
          const draft = drafts[student.id];
          const locked = Boolean(record && (record.status === "confirmed" || record.status === "sent" || record.status === "declined") && !editing[student.id]);
          const entries = locked && record ? record.entries : draftEntries(draft);
          return (
            <section key={student.id} className="card req-student">
              <div className="req-head">
                <div className="grow" style={{ minWidth: 0 }}>
                  <strong>{student.name}</strong>
                  <div className="small muted">
                    {entries.length} date{entries.length === 1 ? "" : "s"}
                    {!student.phone ? " · no WhatsApp number" : ""}
                  </div>
                </div>
                <span className={`badge plain tone-${meta.tone}`}>
                  {status === "confirmed" && record?.answeredBy === "staff" ? "Confirmed (by you)" : meta.label}
                  {status === "confirmed" && record?.officeSentAt ? " · sent to office" : ""}
                </span>
              </div>

              {record?.status === "change_requested" && record.note ? (
                <div className="notice info" style={{ margin: "0 16px 10px" }}>
                  <Icon name="info" size={17} />
                  <div>
                    <strong>{student.name.split(" ")[0]} wrote:</strong> “{record.note}”. Adjust the schedule below, then send the updated one or
                    mark it confirmed.
                  </div>
                </div>
              ) : null}

              <div className="req-body">
                {locked ? (
                  <div className="stack tight small">
                    {groupEntries(entries).map((g) => (
                      <div key={`${g.weekday}-${g.start}`}>
                        <strong>{groupHeading(g)}</strong> <span className="muted">· {datesLine(g.dates)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {draft.groups.map((g) => {
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
                                  setDraft(student.id, (d) => ({ ...d, groups: d.groups.map((y) => (y.key === g.key ? { ...y, start: e.target.value } : y)) }))
                                }
                              />
                              <span className="small muted">to</span>
                              <input
                                className="input"
                                type="time"
                                value={g.end}
                                aria-label="End"
                                onChange={(e) =>
                                  setDraft(student.id, (d) => ({ ...d, groups: d.groups.map((y) => (y.key === g.key ? { ...y, end: e.target.value } : y)) }))
                                }
                              />
                            </div>
                            {changed ? (
                              <button
                                type="button"
                                className="badge plain tone-amber import-regular"
                                onClick={() =>
                                  setDraft(student.id, (d) => ({
                                    ...d,
                                    groups: d.groups.map((y) => (y.key === g.key ? { ...y, start: y.usualStart, end: y.usualEnd } : y))
                                  }))
                                }
                              >
                                Changed · usual {time12(g.usualStart)} ✕
                              </button>
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
                                  setDraft(student.id, (x) => ({
                                    ...x,
                                    groups: x.groups.map((y) =>
                                      y.key === g.key ? { ...y, dates: y.dates.map((z) => (z.date === d.date ? { ...z, on: !z.on } : z)) } : y
                                    )
                                  }))
                                }
                              >
                                {Number(d.date.slice(8, 10))}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {draft.extras.map((e, i) => (
                      <div key={`${e.date}-${i}`} className="req-extra small">
                        <span>
                          Extra: <strong>{Number(e.date.slice(8, 10))} {monthName(month).slice(0, 3)}</strong> · {time12(e.start)} – {time12(e.end)}
                        </span>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => setDraft(student.id, (x) => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <details className="disclosure">
                      <summary className="btn small ghost">
                        <Icon name="plus" size={14} /> Add a date
                      </summary>
                      <div className="row wrap" style={{ marginTop: 8 }}>
                        <input
                          className="input"
                          type="date"
                          min={`${month}-01`}
                          max={`${month}-31`}
                          value={extraDraft[student.id]?.date ?? ""}
                          onChange={(e) => setExtra(student.id, { date: e.target.value })}
                          style={{ width: 160 }}
                        />
                        <input
                          className="input"
                          type="time"
                          value={extraDraft[student.id]?.start ?? "12:00"}
                          onChange={(e) => setExtra(student.id, { start: e.target.value })}
                          style={{ width: 120 }}
                        />
                        <input
                          className="input"
                          type="time"
                          value={extraDraft[student.id]?.end ?? "13:00"}
                          onChange={(e) => setExtra(student.id, { end: e.target.value })}
                          style={{ width: 120 }}
                        />
                        <button
                          type="button"
                          className="btn small"
                          disabled={!extraDraft[student.id]?.date?.startsWith(month)}
                          onClick={() => {
                            const value = extraDraft[student.id];
                            if (!value?.date || value.end <= value.start) return;
                            setDraft(student.id, (x) => ({ ...x, extras: [...x.extras, value] }));
                            setExtra(student.id, { date: "" });
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </details>
                  </>
                )}

                {errors[student.id] ? <span className="small" style={{ color: "var(--red, #c2453b)" }}>{errors[student.id]}</span> : null}

                <div className="row wrap" style={{ gap: 6 }}>
                  {!record || !locked ? (
                    <button type="button" className="btn small whatsapp" disabled={busy === student.id} onClick={() => send(student)}>
                      <Icon name="whatsapp" size={15} /> {record ? "Send updated schedule" : "Send to student"}
                    </button>
                  ) : null}
                  {!record || !locked ? (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy === student.id}
                      onClick={() => send(student, "copy")}
                      title="Copy the message with their link, to paste anywhere"
                    >
                      <Icon name={copiedFor === student.id ? "check" : "copy"} size={14} /> {copiedFor === student.id ? "Copied" : "Copy message"}
                    </button>
                  ) : null}
                  {record && record.status === "sent" && locked ? (
                    <button type="button" className="btn small" onClick={() => copyLinkMessage(student)}>
                      <Icon name={copiedFor === student.id ? "check" : "copy"} size={14} /> {copiedFor === student.id ? "Copied" : "Copy message"}
                    </button>
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

      <aside className="stack req-aside">
        <section className="card card-pad stack">
          <div className="row between">
            <div className="card-title">Message to the office</div>
            <span className="small muted">{officeList.length} confirmed</span>
          </div>
          {notYetToOffice.length && notYetToOffice.length < confirmed.length ? (
            <label className="check small">
              <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
              Only students not sent to the office yet ({notYetToOffice.length})
            </label>
          ) : null}
          <textarea className="input wa-preview req-message" readOnly value={officeMessage || "No confirmed students yet. They appear here as soon as they tap Confirm."} />
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
              ? `${counts.sent + counts.none} student${counts.sent + counts.none === 1 ? " hasn't" : "s haven't"} confirmed yet — you can send now and send the rest later.`
              : "Everyone has answered."}{" "}
            When the office replies with the PDF, import it and Courtside confirms everyone automatically.
          </span>
          {!officePhone ? <span className="small faint">Tip: add the office's WhatsApp number in Settings to open their chat directly.</span> : null}
        </section>
      </aside>
    </div>
  );
}
