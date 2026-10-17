"use client";

import { useActionState, useState } from "react";
import { submitMonthlyResponse, type MonthlyResponseState } from "./actions";
import { SubmitButton } from "@/components/buttons";
import { Icon } from "@/components/icons";

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

export function MonthlyForm({ token, monthName, contactHref }: { token: string; monthName: string; contactHref: string | null }) {
  const [state, action] = useActionState<MonthlyResponseState, FormData>(submitMonthlyResponse, {});
  const [choice, setChoice] = useState("confirm");
  const [note, setNote] = useState("");

  if (state.ok && state.status) {
    const done = DONE[state.status] ?? DONE.confirmed;
    return (
      <div className="empty anim-in" style={{ padding: "28px 8px" }}>
        <div className="empty-icon" style={{ background: "var(--ball)", color: "var(--court)" }}>
          <Icon name="check" size={26} />
        </div>
        <h3 className="display" style={{ fontSize: 24 }}>{done.title}</h3>
        <p>{done.body}</p>
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

  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
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
            <div style={{ fontWeight: 650 }}>Yes, confirm my {monthName} schedule</div>
            <div className="small muted">Same days and times as above</div>
          </div>
        </label>
        <label className="choice">
          <input type="radio" name="choice" value="change" checked={choice === "change"} onChange={() => setChoice("change")} />
          <div>
            <div style={{ fontWeight: 650 }}>I'd like to change something</div>
            <div className="small muted">A different time, day or skip a date</div>
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
            placeholder={choice === "change" ? "e.g. Sundays 1–2 PM instead, and skip Nov 15" : "Optional"}
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
        confirmText="Send your answer? You won't be able to change it online afterwards."
      >
        {choice === "confirm" ? "Confirm schedule" : choice === "change" ? "Send change request" : "Send"}
      </SubmitButton>
    </form>
  );
}
