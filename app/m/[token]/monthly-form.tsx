"use client";

import { useActionState, useMemo, useState } from "react";
import { submitMonthlyResponse, type MonthlyResponseState } from "./actions";
import { SubmitButton } from "@/components/buttons";
import { Icon } from "@/components/icons";
import { WEEKDAY_SHORT, groupEntries, groupHeading, type RequestEntry } from "@/lib/regular";

const DONE: Record<string, { title: string; body: string }> = {
  confirmed: {
    title: "Thank you!",
    body: "Your schedule is confirmed. We'll book your courts with the office and let you know if anything changes."
  },
  change_requested: {
    title: "Request received",
    body: "Thanks! We'll check with the office and message you about your new schedule."
  },
  declined: {
    title: "Thanks for letting us know",
    body: "We've noted that you're not continuing this month. Message us any time to come back."
  }
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function chipLabel(date: string): { day: string; num: string } {
  const d = new Date(`${date}T12:00:00Z`);
  return { day: WEEKDAY_SHORT[d.getUTCDay()], num: `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}` };
}

export function MonthlyForm({
  token,
  monthName,
  entries,
  contactHref
}: {
  token: string;
  monthName: string;
  entries: RequestEntry[];
  contactHref: string | null;
}) {
  const [state, action] = useActionState<MonthlyResponseState, FormData>(submitMonthlyResponse, {});
  const [choice, setChoice] = useState("confirm");
  const [note, setNote] = useState("");
  const allDates = useMemo(() => entries.map((e) => e.date), [entries]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(allDates));
  const groups = useMemo(() => groupEntries(entries), [entries]);
  const allPicked = picked.size === allDates.length;

  if (state.ok && state.status) {
    const done = DONE[state.status] ?? DONE.confirmed;
    const partial = state.status === "confirmed" && state.requested && state.confirmed !== undefined && state.confirmed < state.requested;
    return (
      <div className="empty anim-in" style={{ padding: "28px 8px" }}>
        <div className="empty-icon" style={{ background: "var(--ball)", color: "var(--court)" }}>
          <Icon name="check" size={26} />
        </div>
        <h3 className="display" style={{ fontSize: 24 }}>{done.title}</h3>
        <p>
          {partial
            ? `You confirmed ${state.confirmed} of ${state.requested} dates. We'll book those with the office and let you know if anything changes.`
            : done.body}
        </p>
        <div className="notice info" style={{ margin: "8px 0 0", textAlign: "left" }}>
          <Icon name="info" size={17} />
          <div>
            If you have any concerns, please contact us directly.
            {contactHref ? (
              <div style={{ marginTop: 10 }}>
                <a className="btn whatsapp small" href={contactHref} target="_blank" rel="noopener noreferrer">
                  <Icon name="whatsapp" size={15} /> Message us on WhatsApp
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const toggle = (date: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="has_dates" value="1" />
      {choice === "confirm" ? Array.from(picked).map((d) => <input key={d} type="hidden" name="dates" value={d} />) : null}

      <div className="stack tight">
        <div className="row between wrap">
          <strong>Your {monthName} sessions</strong>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setPicked(allPicked ? new Set() : new Set(allDates))}
          >
            {allPicked ? "Untick all" : "Tick all"}
          </button>
        </div>
        <span className="small muted">All dates are ticked. Untick any date you can't make, then confirm.</span>
        {groups.map((g) => (
          <div key={`${g.weekday}-${g.start}`} className="portal-group">
            <div className="portal-group-head">{groupHeading(g)}</div>
            <div className="portal-dates">
              {g.dates.map((date) => {
                const on = picked.has(date);
                const label = chipLabel(date);
                return (
                  <button
                    key={date}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`portal-date ${on ? "on" : ""}`}
                    onClick={() => toggle(date)}
                  >
                    <span className="portal-date-check">{on ? <Icon name="check" size={13} /> : null}</span>
                    <span className="portal-date-day">{label.day}</span>
                    <span className="portal-date-num">{label.num}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {state.error ? (
        <div className="notice error" role="alert" style={{ margin: 0 }}>
          <Icon name="alert" size={17} />
          <div>{state.error}</div>
        </div>
      ) : null}

      <div className="stack tight" role="radiogroup" aria-label="Your answer">
        <label className="choice">
          <input type="radio" name="choice" value="confirm" checked={choice === "confirm"} onChange={() => setChoice("confirm")} />
          <div>
            <div style={{ fontWeight: 650 }}>
              {allPicked ? `Yes, confirm my ${monthName} schedule` : `Confirm the ${picked.size} ticked date${picked.size === 1 ? "" : "s"}`}
            </div>
            <div className="small muted">{allPicked ? "All dates above" : `${allDates.length - picked.size} unticked date${allDates.length - picked.size === 1 ? "" : "s"} will be skipped`}</div>
          </div>
        </label>
        <label className="choice">
          <input type="radio" name="choice" value="change" checked={choice === "change"} onChange={() => setChoice("change")} />
          <div>
            <div style={{ fontWeight: 650 }}>I'd like a different day or time</div>
            <div className="small muted">Tell us what works better</div>
          </div>
        </label>
        <label className="choice">
          <input type="radio" name="choice" value="decline" checked={choice === "decline"} onChange={() => setChoice("decline")} />
          <div>
            <div style={{ fontWeight: 650 }}>I'm not continuing this month</div>
            <div className="small muted">We'll release your slots</div>
          </div>
        </label>
      </div>
      {choice === "change" || choice === "decline" ? (
        <label className="field anim-in">
          <span>{choice === "change" ? "What would you like to change?" : "Anything we should know? (optional)"}</span>
          <textarea
            className="input"
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            required={choice === "change"}
            placeholder={choice === "change" ? "e.g. Sundays 1–2 PM instead" : "Optional"}
          />
        </label>
      ) : null}
      <p className="small muted" style={{ textAlign: "center" }}>
        You can only answer once. If anything changes later, please contact us directly.
      </p>
      <SubmitButton
        variant="primary"
        size="lg"
        block
        pendingText="Sending…"
        disabled={choice === "confirm" && picked.size === 0}
        confirmText="Send your answer? You won't be able to change it online afterwards."
      >
        {choice === "confirm"
          ? picked.size === 0
            ? "Tick at least one date"
            : allPicked
              ? "Confirm schedule"
              : `Confirm ${picked.size} date${picked.size === 1 ? "" : "s"}`
          : choice === "change"
            ? "Send change request"
            : "Send"}
      </SubmitButton>
    </form>
  );
}
