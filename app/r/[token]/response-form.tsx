"use client";

import { useActionState, useState } from "react";
import { submitResponse, type ResponseState } from "./actions";
import { SubmitButton } from "@/components/buttons";
import { Icon } from "@/components/icons";

const DONE: Record<string, { title: string; body: string }> = {
  pending_approval: {
    title: "Thank you!",
    body: "We've received your confirmation. The club office will finalise your booking, and we'll message you as soon as it's approved."
  },
  confirmed: { title: "You're confirmed!", body: "Thank you. We've let your coach know. See you on court." },
  declined: { title: "Thanks for letting us know", body: "We've released this time. We'll be in touch if you'd like to book again." },
  reschedule_requested: {
    title: "Request received",
    body: "We'll message you shortly with a new time based on your preferences."
  }
};

export function ResponseForm({ token, currentStatus }: { token: string; currentStatus: string }) {
  const [state, action] = useActionState<ResponseState, FormData>(submitResponse, {});
  const [choice, setChoice] = useState<string>(currentStatus === "confirmed" || currentStatus === "pending_approval" ? "" : "confirm");
  const [note, setNote] = useState("");

  if (state.ok && state.status) {
    const done = DONE[state.status] ?? DONE.pending_approval;
    return (
      <div className="empty anim-in" style={{ padding: "28px 8px" }}>
        <div className="empty-icon" style={{ background: "var(--ball)", color: "var(--court)" }}>
          <Icon name="check" size={26} />
        </div>
        <h3 className="display" style={{ fontSize: 24 }}>{done.title}</h3>
        <p>{done.body}</p>
        <a className="btn" href={`/r/${token}`} style={{ marginTop: 8 }}>
          Back to booking
        </a>
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
            <div style={{ fontWeight: 650 }}>Yes, I'll be there</div>
            <div className="small muted">Confirm this session</div>
          </div>
        </label>
        <label className="choice">
          <input type="radio" name="choice" value="reschedule" checked={choice === "reschedule"} onChange={() => setChoice("reschedule")} />
          <div>
            <div style={{ fontWeight: 650 }}>I need a different time</div>
            <div className="small muted">Tell us what works better</div>
          </div>
        </label>
        <label className="choice">
          <input type="radio" name="choice" value="decline" checked={choice === "decline"} onChange={() => setChoice("decline")} />
          <div>
            <div style={{ fontWeight: 650 }}>I can't make it</div>
            <div className="small muted">Release this time slot</div>
          </div>
        </label>
      </div>
      {choice === "reschedule" || choice === "decline" ? (
        <label className="field anim-in">
          <span>{choice === "reschedule" ? "Which days or times work for you?" : "Reason (optional)"}</span>
          <textarea
            className="input"
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            required={choice === "reschedule"}
            placeholder={choice === "reschedule" ? "e.g. Weekday evenings after 6 PM, or Saturday morning" : "Optional"}
          />
        </label>
      ) : null}
      <SubmitButton variant="primary" size="lg" block pendingText="Sending…" disabled={!choice}>
        {choice === "confirm" ? "Confirm session" : choice === "reschedule" ? "Request new time" : choice === "decline" ? "Send" : "Choose an option"}
      </SubmitButton>
    </form>
  );
}
