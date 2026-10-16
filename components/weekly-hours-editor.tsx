"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";

export interface BreakSlot {
  start: string;
  end: string;
  label: string;
}

export interface DaySchedule {
  weekday: number;
  on: boolean;
  start: string;
  end: string;
  breaks: BreakSlot[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function WeeklyHoursEditor({
  coachId,
  initial,
  canEdit,
  action
}: {
  coachId: string;
  initial: DaySchedule[];
  canEdit: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [days, setDays] = useState<DaySchedule[]>(initial);

  const update = (weekday: number, change: (day: DaySchedule) => DaySchedule) => {
    setDays((current) => current.map((day) => (day.weekday === weekday ? change(day) : day)));
  };

  const copyToAll = (source: DaySchedule) => {
    setDays((current) =>
      current.map((day) =>
        day.weekday === source.weekday || !day.on
          ? day
          : { ...day, start: source.start, end: source.end, breaks: source.breaks.map((b) => ({ ...b })) }
      )
    );
  };

  return (
    <form action={action}>
      <input type="hidden" name="coach_id" value={coachId} />
      <input type="hidden" name="schedule" value={JSON.stringify(days)} />
      <div className="list">
        {days.map((day) => (
          <div key={day.weekday} className="list-item" style={{ padding: "12px 20px", display: "block" }}>
            <div className="row wrap">
              <label className="check" style={{ width: 130 }}>
                <input
                  type="checkbox"
                  checked={day.on}
                  disabled={!canEdit}
                  onChange={(event) => update(day.weekday, (d) => ({ ...d, on: event.target.checked }))}
                />
                {DAY_NAMES[day.weekday]}
              </label>
              {day.on ? (
                <>
                  <input
                    className="input"
                    type="time"
                    value={day.start}
                    disabled={!canEdit}
                    style={{ width: 125 }}
                    aria-label={`${DAY_NAMES[day.weekday]} start`}
                    onChange={(event) => update(day.weekday, (d) => ({ ...d, start: event.target.value }))}
                  />
                  <span className="muted">to</span>
                  <input
                    className="input"
                    type="time"
                    value={day.end}
                    disabled={!canEdit}
                    style={{ width: 125 }}
                    aria-label={`${DAY_NAMES[day.weekday]} end`}
                    onChange={(event) => update(day.weekday, (d) => ({ ...d, end: event.target.value }))}
                  />
                  {canEdit ? (
                    <div className="row" style={{ marginLeft: "auto" }}>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          update(day.weekday, (d) => {
                            const last = d.breaks[d.breaks.length - 1];
                            const start = last ? last.end : "12:00";
                            return { ...d, breaks: [...d.breaks, { start, end: addMinutes(start, 60), label: "" }] };
                          })
                        }
                      >
                        <Icon name="plus" size={14} /> Add break
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => copyToAll(day)} title="Copy these hours and breaks to all working days">
                        <Icon name="copy" size={14} /> Copy to all days
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <span className="small faint">Day off</span>
              )}
            </div>

            {day.on && day.breaks.length > 0 ? (
              <div className="stack tight break-list">
                {day.breaks.map((slot, index) => (
                  <div key={index} className="row wrap" style={{ gap: 8 }}>
                    <span className="badge plain tone-ball" style={{ width: 64, justifyContent: "center" }}>
                      Break
                    </span>
                    <input
                      className="input"
                      type="time"
                      value={slot.start}
                      disabled={!canEdit}
                      style={{ width: 120, height: 34 }}
                      aria-label="Break start"
                      onChange={(event) =>
                        update(day.weekday, (d) => ({
                          ...d,
                          breaks: d.breaks.map((b, i) => (i === index ? { ...b, start: event.target.value } : b))
                        }))
                      }
                    />
                    <span className="muted small">to</span>
                    <input
                      className="input"
                      type="time"
                      value={slot.end}
                      disabled={!canEdit}
                      style={{ width: 120, height: 34 }}
                      aria-label="Break end"
                      onChange={(event) =>
                        update(day.weekday, (d) => ({
                          ...d,
                          breaks: d.breaks.map((b, i) => (i === index ? { ...b, end: event.target.value } : b))
                        }))
                      }
                    />
                    <input
                      className="input"
                      value={slot.label}
                      disabled={!canEdit}
                      placeholder="Lunch, rest, travel…"
                      maxLength={60}
                      style={{ width: 170, height: 34 }}
                      aria-label="Break label"
                      onChange={(event) =>
                        update(day.weekday, (d) => ({
                          ...d,
                          breaks: d.breaks.map((b, i) => (i === index ? { ...b, label: event.target.value } : b))
                        }))
                      }
                    />
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn small ghost"
                        aria-label="Remove break"
                        onClick={() => update(day.weekday, (d) => ({ ...d, breaks: d.breaks.filter((_, i) => i !== index) }))}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {canEdit ? (
        <div className="row between wrap" style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
          <span className="small muted">Breaks can't be booked. Times outside working hours show a warning.</span>
          <SubmitButton variant="primary" size="small">
            Save hours
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
