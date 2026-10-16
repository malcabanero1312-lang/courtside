"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { saveAppointment, type AppointmentFormState } from "@/app/(app)/appointments/actions";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import type { Coach, Court, Membership, SessionType, SlotIssue, SlotSuggestion, Venue } from "@/lib/types";

interface StudentOption {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  guardian_name?: string | null;
}

interface Props {
  mode: "create" | "reschedule";
  appointmentId?: string;
  version?: number;
  coaches: Coach[];
  venues: Venue[];
  courts: Court[];
  sessionTypes: SessionType[];
  agents: Pick<Membership, "id" | "full_name" | "email">[];
  defaults: {
    student?: StudentOption | null;
    coachId?: string;
    venueId?: string;
    courtId?: string;
    sessionTypeId?: string;
    date: string;
    time: string;
    duration: number;
    agentId?: string;
    notes?: string;
  };
  stepMinutes: number;
}

const DURATIONS = [30, 45, 60, 75, 90, 120, 150, 180];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function StudentPicker({
  value,
  onChange
}: {
  value: StudentOption | null;
  onChange: (student: StudentOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 200);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/students/search?q=${encodeURIComponent(debounced)}`)
      .then((response) => response.json())
      .then((data: { students?: StudentOption[] }) => {
        if (!cancelled) {
          setResults(data.students ?? []);
          setActive(0);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (value) {
    return (
      <div className="selected-student">
        <div className="avatar">{value.full_name.slice(0, 1).toUpperCase()}</div>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>{value.full_name}</div>
          <div className="small muted">
            {[value.phone ? `+${value.phone}` : null, value.email, value.guardian_name ? `Guardian: ${value.guardian_name}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button type="button" className="btn small ghost" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="picker" ref={boxRef}>
      <div style={{ position: "relative" }}>
        <input
          className="input"
          placeholder="Search by name, phone or email…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && open && results[active]) {
              event.preventDefault();
              onChange(results[active]);
              setOpen(false);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          aria-label="Search students"
          autoComplete="off"
        />
        <span style={{ position: "absolute", right: 12, top: 11, color: "var(--faint)" }}>
          <Icon name="search" size={17} />
        </span>
      </div>
      {open ? (
        <div className="picker-menu" role="listbox">
          {loading && results.length === 0 ? <div className="small muted" style={{ padding: 10 }}>Searching…</div> : null}
          {!loading && results.length === 0 ? (
            <div className="small muted" style={{ padding: 10 }}>
              No matching students. Use “New student” below to add them.
            </div>
          ) : null}
          {results.map((student, index) => (
            <button
              type="button"
              key={student.id}
              className={`picker-option ${index === active ? "active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                onChange(student);
                setOpen(false);
              }}
            >
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                {student.full_name.slice(0, 1).toUpperCase()}
              </div>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{student.full_name}</div>
                <div className="small muted truncate">
                  {[student.phone ? `+${student.phone}` : null, student.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IssueList({ issues }: { issues: SlotIssue[] }) {
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

export function AppointmentForm(props: Props) {
  const { mode, defaults } = props;
  const [state, formAction] = useActionState<AppointmentFormState, FormData>(saveAppointment, { status: "idle" });

  const [student, setStudent] = useState<StudentOption | null>(defaults.student ?? null);
  const [newStudentMode, setNewStudentMode] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: "", phone: "", email: "", guardian: "" });
  const [confirmNewStudent, setConfirmNewStudent] = useState(false);

  const activeCoaches = props.coaches.filter((c) => c.is_active || c.id === defaults.coachId);
  const activeVenues = props.venues.filter((v) => v.is_active || v.id === defaults.venueId);
  const activeTypes = props.sessionTypes.filter((t) => t.is_active || t.id === defaults.sessionTypeId);

  const [sessionTypeId, setSessionTypeId] = useState(defaults.sessionTypeId ?? activeTypes[0]?.id ?? "");
  const [coachId, setCoachId] = useState(defaults.coachId ?? (activeCoaches.length === 1 ? activeCoaches[0].id : ""));
  const [venueId, setVenueId] = useState(defaults.venueId ?? (activeVenues.length === 1 ? activeVenues[0].id : ""));
  const [courtId, setCourtId] = useState(defaults.courtId ?? "");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [duration, setDuration] = useState(defaults.duration);
  const [agentId, setAgentId] = useState(defaults.agentId ?? "");
  const [notes, setNotes] = useState(defaults.notes ?? "");
  const [acknowledge, setAcknowledge] = useState(false);

  const courts = useMemo(
    () => props.courts.filter((c) => c.venue_id === venueId && (c.is_active || c.id === defaults.courtId)),
    [props.courts, venueId, defaults.courtId]
  );

  useEffect(() => {
    if (courtId && !courts.some((c) => c.id === courtId)) setCourtId("");
  }, [courts, courtId]);

  useEffect(() => {
    setAcknowledge(false);
  }, [coachId, venueId, courtId, date, time, duration, student]);

  const durationOptions = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  const [live, setLive] = useState<{
    loading: boolean;
    issues: SlotIssue[];
    suggestions: SlotSuggestion[];
    checked: boolean;
    message?: string;
  }>({ loading: false, issues: [], suggestions: [], checked: false });

  const slotKey = useDebounced(JSON.stringify({ coachId, venueId, courtId, date, time, duration, studentId: student?.id ?? null }), 350);

  useEffect(() => {
    const parsed = JSON.parse(slotKey) as Record<string, string | number | null>;
    if (!parsed.coachId || !parsed.venueId || !parsed.date || !parsed.time) {
      setLive({ loading: false, issues: [], suggestions: [], checked: false });
      return;
    }
    let cancelled = false;
    setLive((current) => ({ ...current, loading: true }));
    fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed, excludeId: mode === "reschedule" ? props.appointmentId : null })
    })
      .then((response) => response.json())
      .then((data: { issues?: SlotIssue[]; suggestions?: SlotSuggestion[]; incomplete?: boolean; message?: string }) => {
        if (cancelled) return;
        setLive({
          loading: false,
          issues: data.issues ?? [],
          suggestions: data.suggestions ?? [],
          checked: !data.incomplete,
          message: data.incomplete ? data.message : undefined
        });
      })
      .catch(() => {
        if (!cancelled) setLive({ loading: false, issues: [], suggestions: [], checked: false });
      });
    return () => {
      cancelled = true;
    };
  }, [slotKey, mode, props.appointmentId]);

  const blocking = live.issues.filter((i) => i.severity === "block");
  const warnings = live.issues.filter((i) => i.severity === "warn");
  const suggestions = state.status === "conflict" && state.suggestions?.length ? state.suggestions : live.suggestions;

  const applySuggestion = (suggestion: SlotSuggestion) => {
    setDate(suggestion.date);
    setTime(suggestion.time);
    if (suggestion.court_id) setCourtId(suggestion.court_id);
  };

  return (
    <form action={formAction} className="grid main-side">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="appointment_id" value={props.appointmentId ?? ""} />
      <input type="hidden" name="version" value={props.version ?? ""} />
      <input type="hidden" name="acknowledge" value={acknowledge ? "1" : ""} />
      <input type="hidden" name="confirm_new_student" value={confirmNewStudent ? "1" : ""} />

      <div className="stack">
        {state.status === "error" && state.message ? (
          <div className="notice error anim-in" role="alert">
            <Icon name="alert" size={17} />
            <div>{state.message}</div>
          </div>
        ) : null}

        {state.status === "duplicate" && state.duplicates ? (
          <div className="notice warn anim-in">
            <Icon name="users" size={17} />
            <div className="grow">
              <strong>{state.message}</strong>
              <div className="stack tight" style={{ marginTop: 10 }}>
                {state.duplicates.map((dup) => (
                  <div key={dup.id} className="row between wrap">
                    <span>
                      {dup.full_name}{" "}
                      <span className="muted small">{[dup.phone ? `+${dup.phone}` : null, dup.email].filter(Boolean).join(" · ")}</span>
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setStudent(dup);
                        setNewStudentMode(false);
                      }}
                    >
                      Use this student
                    </button>
                  </div>
                ))}
                <label className="check small">
                  <input type="checkbox" checked={confirmNewStudent} onChange={(e) => setConfirmNewStudent(e.target.checked)} />
                  No, this is a different person (e.g. a sibling sharing a parent's phone)
                </label>
              </div>
            </div>
          </div>
        ) : null}

        {mode === "create" ? (
          <section className="card">
            <div className="card-head">
              <div className="card-title">Student</div>
              {!student ? (
                <button type="button" className="btn small ghost" onClick={() => setNewStudentMode((v) => !v)}>
                  <Icon name={newStudentMode ? "search" : "plus"} size={15} />
                  {newStudentMode ? "Search existing" : "New student"}
                </button>
              ) : null}
            </div>
            <div className="card-body stack">
              <input type="hidden" name="student_id" value={student?.id ?? ""} />
              {!newStudentMode || student ? (
                <StudentPicker value={student} onChange={setStudent} />
              ) : (
                <div className="form-grid">
                  <label className="field span-2">
                    <span>Full name</span>
                    <input
                      className="input"
                      name="new_student_name"
                      value={newStudent.name}
                      onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                      placeholder="Carla Mendoza"
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>WhatsApp number</span>
                    <input
                      className="input"
                      name="new_student_phone"
                      value={newStudent.phone}
                      onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value })}
                      placeholder="0917 123 4567"
                      inputMode="tel"
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span>Email (for confirmations)</span>
                    <input
                      className="input"
                      name="new_student_email"
                      type="email"
                      value={newStudent.email}
                      onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                      placeholder="carla@email.com"
                      autoComplete="off"
                    />
                  </label>
                  <label className="field span-2">
                    <span>Parent / guardian (optional)</span>
                    <input
                      className="input"
                      name="new_student_guardian"
                      value={newStudent.guardian}
                      onChange={(e) => setNewStudent({ ...newStudent, guardian: e.target.value })}
                      placeholder="For junior players"
                      autoComplete="off"
                    />
                  </label>
                </div>
              )}
            </div>
          </section>
        ) : null}

        <section className="card">
          <div className="card-head">
            <div className="card-title">When & where</div>
          </div>
          <div className="card-body form-grid">
            {mode === "create" ? (
              <label className="field">
                <span>Session type</span>
                <select
                  className="input"
                  name="session_type_id"
                  value={sessionTypeId}
                  onChange={(e) => {
                    setSessionTypeId(e.target.value);
                    const type = props.sessionTypes.find((t) => t.id === e.target.value);
                    if (type) setDuration(type.duration_minutes);
                  }}
                >
                  <option value="">Not specified</option>
                  {activeTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>Coach</span>
              <select className="input" name="coach_id" value={coachId} onChange={(e) => setCoachId(e.target.value)} required>
                <option value="">Choose a coach…</option>
                {activeCoaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coach.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Venue</span>
              <select className="input" name="venue_id" value={venueId} onChange={(e) => setVenueId(e.target.value)} required>
                <option value="">Choose a venue…</option>
                {activeVenues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Court</span>
              <select className="input" name="court_id" value={courtId} onChange={(e) => setCourtId(e.target.value)} disabled={!venueId}>
                <option value="">{courts.length ? "Any / decide later" : "No courts set up"}</option>
                {courts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date</span>
              <input className="input" type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>Start time</span>
              <input
                className="input"
                type="time"
                name="time"
                value={time}
                step={props.stepMinutes * 60}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Length</span>
              <select className="input" name="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {durationOptions.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="span-2">
              {live.loading ? (
                <div className="availability tone-slate">
                  <Icon name="clock" size={16} /> Checking availability…
                </div>
              ) : live.checked && blocking.length === 0 && warnings.length === 0 ? (
                <div className="availability tone-green">
                  <Icon name="checkCircle" size={16} /> Available — no conflicts
                </div>
              ) : blocking.length > 0 ? (
                <div className="availability tone-red" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
                  <div className="row">
                    <Icon name="alert" size={16} /> Not available
                  </div>
                  <div style={{ fontWeight: 500 }}>
                    <IssueList issues={blocking} />
                  </div>
                </div>
              ) : warnings.length > 0 ? (
                <div className="availability tone-amber" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
                  <div className="row">
                    <Icon name="info" size={16} /> Available, with a note
                  </div>
                  <div style={{ fontWeight: 500 }}>
                    <IssueList issues={warnings} />
                  </div>
                </div>
              ) : null}
            </div>

            {suggestions.length > 0 ? (
              <div className="span-2 stack tight">
                <span className="label">Free times nearby — tap to use</span>
                <div className="slot-chips">
                  {suggestions.map((s) => (
                    <button type="button" key={s.starts_at + (s.court_id ?? "")} className="slot-chip" onClick={() => applySuggestion(s)}>
                      {s.label}
                      {s.court_id && s.court_id !== courtId ? ` · ${props.courts.find((c) => c.id === s.court_id)?.name ?? ""}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <aside className="stack" style={{ position: "sticky", top: 20 }}>
        {mode === "create" ? (
          <section className="card">
            <div className="card-head">
              <div className="card-title">Details</div>
            </div>
            <div className="card-body stack">
              <label className="field">
                <span>Handled by</span>
                <select className="input" name="agent_id" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Me</option>
                  {props.agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.full_name || agent.email}
                    </option>
                  ))}
                </select>
                <small>Gets email updates when the student replies.</small>
              </label>
              <label className="field">
                <span>Notes for the coach</span>
                <textarea
                  className="input"
                  name="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Working on second serve"
                  maxLength={1000}
                />
              </label>
            </div>
          </section>
        ) : null}

        {(state.status === "warning" || state.status === "conflict") && state.issues?.length ? (
          <div className={`notice ${state.status === "conflict" ? "error" : "warn"} anim-in`}>
            <Icon name="alert" size={17} />
            <div>
              <strong>{state.message}</strong>
              <IssueList issues={state.issues} />
            </div>
          </div>
        ) : null}

        {warnings.length > 0 && blocking.length === 0 ? (
          <label className="check small card card-pad">
            <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
            I've checked the note above — save anyway
          </label>
        ) : null}

        <SubmitButton variant="primary" size="lg" block icon="check" pendingText="Saving…" disabled={blocking.length > 0}>
          {mode === "create" ? "Book appointment" : "Move to this time"}
        </SubmitButton>
        <p className="small muted" style={{ textAlign: "center" }}>
          {mode === "create"
            ? "Next you'll get a ready-to-send WhatsApp message."
            : "The old time is kept in the history and the student gets a fresh link."}
        </p>
      </aside>
    </form>
  );
}
