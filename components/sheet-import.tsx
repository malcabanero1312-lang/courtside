"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { importSheetSessions, type ImportResult } from "@/app/(app)/import/actions";
import { parseCourtSheet } from "@/lib/court-sheet";
import { readPdfTextInBrowser } from "@/lib/pdf-browser";

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
  studentNames,
  defaultDaysBefore,
  today
}: {
  coaches: { id: string; full_name: string }[];
  venues: { id: string; name: string }[];
  studentNames: string[];
  defaultDaysBefore: number;
  today: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetCoach, setSheetCoach] = useState("");
  const [coachId, setCoachId] = useState("");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [daysBefore, setDaysBefore] = useState(defaultDaysBefore);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, startSaving] = useTransition();

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
          include: Boolean(s.student.trim()) && !group && !past
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
  const newNames = new Set(included.filter((r) => !known.has(r.name.trim().toLowerCase())).map((r) => r.name.trim().toLowerCase()));

  const setRow = (key: string, change: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const runImport = () => {
    setError(null);
    startSaving(async () => {
      const res = await importSheetSessions({
        coachId,
        venueId,
        daysBefore,
        rows: included.map((r) => ({ date: r.date, startHour: r.startHour, endHour: r.endHour, court: r.court, student: r.name }))
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
              Imported {result.created} session{result.created === 1 ? "" : "s"} for Coach {sheetCoach}.
            </strong>{" "}
            They're approved by the office and will appear in <strong>To do</strong> {daysBefore} day{daysBefore === 1 ? "" : "s"} before
            each lesson, ready to send for confirmation.
          </div>
        </div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {result.alreadyThere ? <li>{result.alreadyThere} were already in Courtside and were skipped.</li> : null}
          {result.newStudents ? (
            <li>
              {result.newStudents} new student{result.newStudents === 1 ? "" : "s"} added — add their WhatsApp numbers on the Students page.
            </li>
          ) : null}
          {result.newCourts ? <li>{result.newCourts} court{result.newCourts === 1 ? "" : "s"} added to the venue.</li> : null}
        </ul>
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
            <label className="field">
              <span>Ask students to confirm</span>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={30}
                  value={daysBefore}
                  onChange={(e) => setDaysBefore(Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
                  style={{ width: 80 }}
                />
                <span className="small muted">days before each lesson</span>
              </div>
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

      {sheet && rows.length ? (
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">3. Check the sessions</div>
              <div className="small muted">
                Untick anything you don't want. Group classes and past dates start unticked. You can fix a student's name.
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, include: !x.past && Boolean(x.name.trim()) })))}>
                Tick all
              </button>
              <button type="button" className="btn small ghost" onClick={() => setRows((r) => r.map((x) => ({ ...x, include: false })))}>
                Untick all
              </button>
            </div>
          </div>
          <div className="list">
            {rows.map((row) => {
              const isNew = !known.has(row.name.trim().toLowerCase());
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
                      {hourLabel(row.startHour)}–{hourLabel(row.endHour)} · {row.court}
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
                    {row.name.trim() ? (
                      <span className={`badge plain ${isNew ? "tone-ball" : "tone-green"}`}>{isNew ? "New student" : "Existing"}</span>
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
              {included.length} selected{newNames.size ? ` · ${newNames.size} new student${newNames.size === 1 ? "" : "s"} will be added` : ""}
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
