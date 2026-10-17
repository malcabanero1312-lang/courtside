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

  const setBreak = (weekday: number, index: number, change: Partial<BreakSlot>) => {
    update(weekday, (d) => ({ ...d, breaks: d.breaks.map((b, i) => (i === index ? { ...b, ...change } : b)) }));
  };

  return (
    <form action={action}>
      <input type="hidden" name="coach_id" value={coachId} />
      <input type="hidden" name="schedule" value={JSON.stringify(days)} />
      <div className="hours-list">
        {days.map((day) => (
          <div key={day.weekday} className={`hours-day ${day.on ? "" : "off"}`}>
            <label className="check hours-name">
              <input
                type="checkbox"
                checked={day.on}
                disabled={!canEdit}
                onChange={(event) => update(day.weekday, (d) => ({ ...d, on: event.target.checked }))}
              />
              {DAY_NAMES[day.weekday]}
            </label>

            <div className="hours-main">
              {day.on ? (
                <div className="hours-times">
                  <label className="hours-field">
                    <span>Start</span>
                    <input
                      className="input"
                      type="time"
                      value={day.start}
                      disabled={!canEdit}
                      onChange={(event) => update(day.weekday, (d) => ({ ...d, start: event.target.value }))}
                    />
                  </label>
                  <span className="hours-sep">to</span>
                  <label className="hours-field">
                    <span>End</span>
                    <input
                      className="input"
                      type="time"
                      value={day.end}
                      disabled={!canEdit}
                      onChange={(event) => update(day.weekday, (d) => ({ ...d, end: event.target.value }))}
                    />
                  </label>
                </div>
              ) : (
                <span className="small faint">Day off</span>
              )}
            </div>

            {day.on && canEdit ? (
              <button type="button" className="btn small ghost hours-copy" onClick={() => copyToAll(day)} title="Copy these hours and breaks to all working days">
                <Icon name="copy" size={14} /> Copy to all
              </button>
            ) : null}

            {day.on && day.breaks.length > 0 ? (
              <div className="hours-breaks">
                {day.breaks.map((slot, index) => (
                  <div key={index} className="hours-break">
                    <span className="badge plain tone-ball hours-break-tag">Break</span>
                    <div className="hours-times">
                      <label className="hours-field">
                        <span>From</span>
                        <input
                          className="input"
                          type="time"
                          value={slot.start}
                          disabled={!canEdit}
                          onChange={(event) => setBreak(day.weekday, index, { start: event.target.value })}
                        />
                      </label>
                      <span className="hours-sep">to</span>
                      <label className="hours-field">
                        <span>Until</span>
                        <input
                          className="input"
                          type="time"
                          value={slot.end}
                          disabled={!canEdit}
                          onChange={(event) => setBreak(day.weekday, index, { end: event.target.value })}
                        />
                      </label>
                    </div>
                    <input
                      className="input hours-break-label"
                      value={slot.label}
                      disabled={!canEdit}
                      placeholder="Break: lunch, rest, travel…"
                      maxLength={60}
                      aria-label="Break label"
                      onChange={(event) => setBreak(day.weekday, index, { label: event.target.value })}
                    />
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn small ghost hours-break-remove"
                        aria-label="Remove break"
                        onClick={() => update(day.weekday, (d) => ({ ...d, breaks: d.breaks.filter((_, i) => i !== index) }))}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {day.on && canEdit ? (
              <button
                type="button"
                className="btn small ghost hours-add"
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
