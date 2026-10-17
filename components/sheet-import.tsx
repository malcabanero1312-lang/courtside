"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { importSheetSessions, type ImportResult } from "@/app/(app)/import/actions";
import { parseCourtSheet } from "@/lib/court-sheet";
import { readPdfTextInBrowser } from "@/lib/pdf-browser";
import { splitSharedNames } from "@/lib/shared-lessons";
import { buildMissingMessage, namesMatch, time12 } from "@/lib/regular";
import { openWhatsApp } from "@/lib/whatsapp";

export interface RequestedItem {
  id: string;
  studentId: string;
  studentName: string;
  phone: string | null;
  coachId: string | null;
  date: string;
  start: string;
  end: string;
}

interface RowMatch {
  name: string;
  appointmentId: string;
  studentId: string;
  same: boolean;
  requested: string;
}

interface SheetSession {
  date: string;
  startHour: number;
  endHour: number;
  court: string;
  coach: string;
  student: string;
}

interface ParsedSheet {
  sessions: SheetSession[];
  coaches: string[];
  notes: { date: string; note: string }[];
  days: string[];
}

interface Row extends SheetSession {
  key: string;
  include: boolean;
  name: string;
  group: boolean;
  past: boolean;
}

const GROUP_WORDS = /\b(GROUP|GRP|JR|JUNIOR|LVL|LEVEL|NOVICE|PEE ?WEE|ADVANCED|TNT|CLINIC|SQUAD|CLASS|CAMP)\b/i;

function hourLabel(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

function courtKey(name: string): string {
  return name.toLowerCase().replace(/courts?/g, "court").replace(/[^a-z0-9]/g, "");
}

function bestCoachMatch(sheetCoach: string, coaches: { id: string; full_name: string }[]): string {
  const target = sheetCoach.trim().toLowerCase();
  const exact = coaches.find((c) => c.full_name.trim().toLowerCase() === target);
  if (exact) return exact.id;
  const first = coaches.find((c) => c.full_name.trim().toLowerCase().split(/\s+/)[0] === target);
  if (first) return first.id;
  const partial = coaches.find((c) => c.full_name.toLowerCase().includes(target) || target.includes(c.full_name.toLowerCase()));
  return partial?.id ?? "";
}

export function SheetImport({
  coaches,
  venues,
  courts,
  studentNames,
  today,
  requested = []
}: {
  coaches: { id: string; full_name: string }[];
  venues: { id: string; name: string }[];
  courts: { venueId: string; name: string; altName: string | null }[];
  studentNames: string[];
  today: string;
  requested?: RequestedItem[];
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetCoach, setSheetCoach] = useState("");
  const [coachId, setCoachId] = useState("");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, startSaving] = useTransition();

  const courtLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of courts.filter((x) => x.venueId === venueId)) {
      map.set(courtKey(c.name), c.name);
      if (c.altName) map.set(courtKey(c.altName), c.name);
    }
    return map;
  }, [courts, venueId]);

  const relevantRequests = useMemo(
    () => (sheet ? requested.filter((r) => (!r.coachId || r.coachId === coachId) && sheet.days.includes(r.date)) : []),
    [requested, sheet, coachId]
  );

  const matchesByRow = useMemo(() => {
    const claimed = new Set<string>();
    const map = new Map<string, RowMatch[]>();
    const hh = (n: number) => `${String(n % 24).padStart(2, "0")}:00`;
    const ordered = [...rows].sort((a, b) => Number(b.include) - Number(a.include));
    for (const row of ordered) {
      const names = splitSharedNames(row.name);
      const list: RowMatch[] = [];
      for (const name of names.length ? names : [row.name]) {
        const candidates = relevantRequests.filter((r) => r.date === row.date && !claimed.has(r.id) && namesMatch(name, r.studentName));
        const item = candidates.find((r) => r.start === hh(row.startHour)) ?? candidates[0];
        if (!item) continue;
        claimed.add(item.id);
        list.push({
          name,
          appointmentId: item.id,
          studentId: item.studentId,
          same: item.start === hh(row.startHour) && item.end === hh(row.endHour),
          requested: `${time12(item.start)} – ${time12(item.end)}`
        });
      }
      if (list.length) map.set(row.key, list);
    }
    return map;
  }, [rows, relevantRequests]);

  const missingRequests = useMemo(() => {
    const claimed = new Set<string>();
    for (const row of rows) {
      if (!row.include) continue;
      (matchesByRow.get(row.key) ?? []).forEach((m) => claimed.add(m.appointmentId));
    }
    return relevantRequests.filter((r) => !claimed.has(r.id));
  }, [rows, matchesByRow, relevantRequests]);

  const missingByStudent = useMemo(() => {
    const map = new Map<string, RequestedItem[]>();
    missingRequests.forEach((r) => map.set(r.studentId, [...(map.get(r.studentId) ?? []), r]));
    return Array.from(map.values());
  }, [missingRequests]);

  const known = useMemo(() => new Set(studentNames.map((n) => n.trim().toLowerCase())), [studentNames]);

  const chooseCoach = (name: string, parsed: ParsedSheet | null = sheet) => {
    setSheetCoach(name);
    setCoachId(bestCoachMatch(name, coaches));
    const list = (parsed?.sessions ?? []).filter((s) => s.coach.toUpperCase() === name.toUpperCase());
    setRows(
      list.map((s, i) => {
        const group = GROUP_WORDS.test(s.student);
        const past = s.date < today;
        return {
          ...s,
          key: `${s.date}-${s.startHour}-${s.court}-${i}`,
          name: s.student,
          group,
          past,
          include: Boolean(s.student.trim()) && !group
        };
      })
    );
  };

  const showSheet = (data: ParsedSheet) => {
    setSheet(data);
    const matched = data.coaches.find((c) => bestCoachMatch(c, coaches));
    chooseCoach(matched ?? data.coaches[0] ?? "", data);
  };

  const readOnServer = async (file: File): Promise<boolean> => {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/sheet/parse", { method: "POST", body });
    const data = (await response.json().catch(() => ({}))) as ParsedSheet & { error?: string };
    if (!response.ok || data.error) {
      setError(data.error ?? `We couldn't read that file (error ${response.status}).`);
      setSheet(null);
      return false;
    }
    showSheet(data);
    return true;
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    setSheet(null);
    setFileName(file.name);
    try {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
      if (!isPdf) {
        setError("That isn't a PDF. Download the sheet from SharePoint as PDF (or Print → Save as PDF) and try again.");
        return;
      }

      let items: Awaited<ReturnType<typeof readPdfTextInBrowser>> | null = null;
      try {
        items = await readPdfTextInBrowser(file);
      } catch (browserError) {
        console.warn("[courtside] reading the PDF in the browser failed, trying the server", browserError);
      }

      if (items === null) {
        await readOnServer(file);
        return;
      }
      if (items.length === 0) {
        setError("This PDF has no readable text (it may be a scanned picture). Ask the office for the PDF exported from Excel.");
        return;
      }
      const parsed = parseCourtSheet(items);
      if (parsed.sessions.length === 0) {
        setError("We couldn't find any “COACH …” bookings in this PDF. Make sure it's the office's court booking sheet.");
        return;
      }
      showSheet({ sessions: parsed.sessions, coaches: parsed.coaches, notes: parsed.notes, days: parsed.days });
    } catch {
      setError("Something went wrong reading the file. Check your internet connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const coachCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sheet?.sessions.forEach((s) => counts.set(s.coach.toUpperCase(), (counts.get(s.coach.toUpperCase()) ?? 0) + 1));
    return counts;
  }, [sheet]);

  const coachNotes = useMemo(
    () => (sheet?.notes ?? []).filter((n) => sheetCoach && n.note.toUpperCase().includes(sheetCoach.toUpperCase())),
    [sheet, sheetCoach]
  );

  const included = rows.filter((r) => r.include && r.name.trim());
  const newNames = new Set(
    included.flatMap((r) => splitSharedNames(r.name).map((n) => n.toLowerCase())).filter((n) => !known.has(n))
  );
  const sharedCount = included.filter((r) => splitSharedNames(r.name).length > 1).length;

  const setRow = (key: string, change: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const runImport = () => {
    setError(null);
    startSaving(async () => {
      const res = await importSheetSessions({
        coachId,
        venueId,
        rows: included.map((r) => ({
          date: r.date,
          startHour: r.startHour,
          endHour: r.endHour,
          court: r.court,
          student: r.name,
          matches: (matchesByRow.get(r.key) ?? []).map((m) => ({ name: m.name, appointmentId: m.appointmentId, studentId: m.studentId, same: m.same }))
        })),
        missingAppointmentIds: missingRequests.map((m) => m.id)
      });
      if (!res.ok) {
        setError(res.error ?? "Import failed.");
        return;
      }
      setResult(res);
    });
  };

  if (result) {
    return (
      <div className="card card-pad stack anim-in">
        <div className="notice success" style={{ margin: 0 }}>
          <Icon name="checkCircle" size={17} />
          <div>
            <strong>
              Imported {result.created} booking{result.created === 1 ? "" : "s"} for Coach {sheetCoach}.
            </strong>{" "}
            Everything from the sheet is saved as confirmed — no messages needed.
            {result.weeklySchedules
              ? ` Weekly schedules updated for ${result.weeklySchedules} student${result.weeklySchedules === 1 ? "" : "s"}.`
              : ""}
          </div>
        </div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {result.alreadyThere ? <li>{result.alreadyThere} were already in Courtside and were skipped.</li> : null}
          {result.newStudents ? (
            <li>
              {result.newStudents} new student{result.newStudents === 1 ? "" : "s"} added — add their WhatsApp numbers on the Students page.
            </li>
          ) : null}
          {result.sharedLessons ? (
            <li>
              {result.sharedLessons} shared lesson{result.sharedLessons === 1 ? "" : "s"} — shown side by side on the calendar, one box per
              student.
            </li>
          ) : null}
          {result.newCourts ? <li>{result.newCourts} court{result.newCourts === 1 ? "" : "s"} added to the venue.</li> : null}
        </ul>
        {result.matched || result.timeChanged || result.missing ? (
          <div className="notice info" style={{ margin: 0 }}>
            <Icon name="info" size={17} />
            <div>
              <strong>Compared with what students confirmed:</strong> {result.matched} as requested (no message needed)
              {result.timeChanged ? `, ${result.timeChanged} with a different time (in To do → Tell student)` : ""}
              {result.missing ? `, ${result.missing} not given by the office (in To do → Tell student)` : ""}.
            </div>
          </div>
        ) : null}
        {result.problems.length ? (
          <div className="notice warn" style={{ margin: 0 }}>
            <Icon name="alert" size={17} />
            <div>
              <strong>{result.problems.length} couldn't be imported:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {result.problems.slice(0, 20).map((p, i) => (
                  <li key={i}>
                    {dayLabel(p.date)} {p.time} · {p.student} — {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        <div className="row wrap">
          <Link className="btn primary" href="/calendar">
            <Icon name="calendar" size={16} /> Open calendar
          </Link>
          <Link className="btn" href="/appointments?view=later">
            Scheduled to message later
          </Link>
          <button
            type="button"
            className="btn ghost"
            disabled={!sheet}
            onClick={() => {
              setResult(null);
              chooseCoach(sheetCoach);
            }}
          >
            Import another coach
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {error ? (
        <div className="notice error" role="alert" style={{ margin: 0 }}>
          <Icon name="alert" size={17} />
          <div>{error}</div>
        </div>
      ) : null}

      <section className="card card-pad stack">
        <div className="row between wrap">
          <div>
            <div className="card-title">1. Attach the office sheet</div>
            <div className="small muted">The monthly court bookings PDF from the office (download it from SharePoint as PDF).</div>
          </div>
          {fileName && sheet ? (
            <span className="badge plain tone-green">
              {fileName} · {sheet.days.length} days
            </span>
          ) : null}
        </div>
        <label className="upload-drop">
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
              event.target.value = "";
            }}
          />
          <Icon name="upload" size={22} />
          <span>{uploading ? "Reading the sheet…" : sheet ? "Choose a different PDF" : "Choose PDF"}</span>
        </label>
      </section>

      {sheet ? (
        <section className="card card-pad stack">
          <div className="card-title">2. Choose the coach</div>
          <div className="form-grid">
            <label className="field">
              <span>Coach on the sheet</span>
              <select className="input" value={sheetCoach} onChange={(e) => chooseCoach(e.target.value)}>
                {sheet.coaches.map((c) => (
                  <option key={c} value={c}>
                    {c} ({coachCounts.get(c) ?? 0} sessions)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Courtside coach</span>
              <select className="input" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
                <option value="">Choose…</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
              {!coachId ? <small>No coach called “{sheetCoach}” yet — add them on the Coaches page first.</small> : null}
            </label>
            <label className="field">
              <span>Venue</span>
              <select className="input" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {coachNotes.length ? (
            <div className="notice info" style={{ margin: 0 }}>
              <Icon name="info" size={17} />
              <div>
                <strong>Notes on the sheet:</strong> {coachNotes.map((n) => `${dayLabel(n.date)} — ${n.note}`).join(" · ")}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {sheet && relevantRequests.length ? (
        <section className="card card-pad stack">
          <div className="card-title">Compared with what students confirmed</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="badge plain tone-green">
              ✓ {Array.from(matchesByRow.values()).flat().filter((m) => m.same).length} as requested
            </span>
            <span className="badge plain tone-amber">{Array.from(matchesByRow.values()).flat().filter((m) => !m.same).length} time changed</span>
            <span className="badge plain tone-red">{missingRequests.length} not on the sheet</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            As requested → confirmed, no need to message the student. Time changed → confirmed at the office's time, and it goes to To do
            so you can tell the student. Not on the sheet → marked not approved; tell the student below.
          </p>
          {missingByStudent.length ? (
            <div className="list" style={{ border: "1px solid var(--line)", borderRadius: 10 }}>
              {missingByStudent.map((items) => {
                const first = items[0];
                const message = buildMissingMessage(
                  first.studentName.split(" ")[0],
                  items.map((i) => ({ date: i.date, start: i.start, end: i.end }))
                );
                return (
                  <div key={first.studentId} className="list-item" style={{ flexWrap: "wrap" }}>
                    <div className="grow">
                      <strong>{first.studentName}</strong>
                      <div className="small muted">
                        {items.map((i) => `${dayLabel(i.date)} ${time12(i.start)}`).join(" · ")}
                      </div>
                    </div>
                    <button type="button" className="btn small whatsapp" onClick={() => openWhatsApp(first.phone, message)}>
                      <Icon name="whatsapp" size={15} /> Tell student
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {sheet && rows.length ? (
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">3. Check the sessions</div>
              <div className="small muted">
                Everything ticked is saved as confirmed. Group classes start unticked, and you can fix a student's name. Two names like
                “Lam / Kristen” become two students sharing the slot.
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, include: !Boolean(x.name.trim()) })))}>
                Tick all
              </button>
              <button type="button" className="btn small ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, include: false })))}>
                Untick all
              </button>
            </div>
          </div>
          <div className="list">
            {rows.map((row) => {
              const names = splitSharedNames(row.name);
              const isNew = names.some((n) => !known.has(n.toLowerCase()));
              const allNew = names.length > 0 && names.every((n) => !known.has(n.toLowerCase()));
              return (
                <div key={row.key} className={`list-item import-row ${row.include ? "" : "off"}`}>
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => setRow(row.key, { include: e.target.checked })}
                    aria-label={`Import ${row.name}`}
                    className="import-check"
                  />
                  <div className="import-when">
                    <strong>{dayLabel(row.date)}</strong>
                    <span className="small muted">
                      {hourLabel(row.startHour)}–{hourLabel(row.endHour)} · {courtLookup.get(courtKey(row.court)) ?? row.court}
                    </span>
                  </div>
                  <input
                    className="input import-name"
                    value={row.name}
                    onChange={(e) => setRow(row.key, { name: e.target.value })}
                    aria-label="Student name"
                  />
                  <div className="import-tags">
                    {row.past ? <span className="badge plain tone-muted">Past</span> : null}
                    {row.group ? <span className="badge plain tone-violet">Group class</span> : null}
                    {(matchesByRow.get(row.key) ?? []).map((m) =>
                      m.same ? (
                        <span key={m.appointmentId} className="badge plain tone-green" title="Same as your request — no need to message the student">
                          ✓ {names.length > 1 ? `${m.name.split(" ")[0]}: ` : ""}As requested
                        </span>
                      ) : (
                        <span key={m.appointmentId} className="badge plain tone-amber" title="The office gave a different time — you'll need to tell the student">
                          {names.length > 1 ? `${m.name.split(" ")[0]}: ` : ""}Time changed · asked {m.requested}
                        </span>
                      )
                    )}
                    {names.length > 1 ? <span className="badge plain tone-slate">Shared · {names.length} students</span> : null}
                    {row.name.trim() ? (
                      <span className={`badge plain ${isNew ? "tone-ball" : "tone-green"}`}>
                        {names.length > 1 && isNew && !allNew ? "Some new" : isNew ? (names.length > 1 ? "New students" : "New student") : "Existing"}
                      </span>
                    ) : (
                      <span className="badge plain tone-red">No name</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row between wrap" style={{ padding: "14px 20px", borderTop: "1px solid var(--line)" }}>
            <span className="small muted">
              {included.length} selected
              {sharedCount ? ` · ${sharedCount} shared (each student gets their own confirmation)` : ""}
              {newNames.size ? ` · ${newNames.size} new student${newNames.size === 1 ? "" : "s"} will be added` : ""}
            </span>
            <button type="button" className="btn primary" disabled={saving || !included.length || !coachId || !venueId} onClick={runImport}>
              <Icon name="check" size={16} />
              {saving ? "Importing…" : `Import ${included.length} session${included.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      ) : sheet ? (
        <div className="card card-pad muted">No sessions for this coach on the sheet.</div>
      ) : null}
    </div>
  );
}
