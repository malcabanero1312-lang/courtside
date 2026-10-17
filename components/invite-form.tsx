"use client";

import { useActionState, useState } from "react";
import { inviteWithLogin, type InviteState } from "@/app/(app)/team/invite-actions";
import { CopyButton, SubmitButton } from "@/components/buttons";
import { Icon } from "@/components/icons";
import { openWhatsApp } from "@/lib/whatsapp";

const ROLE_HELP: Record<string, string> = {
  agent: "Books and manages appointments, students and messages",
  coach: "Sees their own sessions, records office decisions, marks attendance",
  admin: "Everything, including settings, team and templates"
};

function buildMessage(state: InviteState, appUrl: string, orgName: string): string {
  const first = (state.name ?? "").split(" ")[0] || "there";
  const lines = [`Hi ${first}! You've been added to ${orgName} on Courtside.`, "", `Log in here: ${appUrl}`, `Email: ${state.email}`];
  if (state.password) {
    lines.push(`Temporary password: ${state.password}`, "", "Please change your password after logging in (My account → Change password).");
  } else if (state.existingAccount) {
    lines.push("", "Use the password you already have. If you forgot it, tap “Forgot password?” on the login page.");
  } else {
    lines.push("", "Click “Create an account” and sign up with this exact email.");
  }
  return lines.join("\n");
}

export function InviteForm({
  appUrl,
  orgName,
  coachId,
  coachEmail
}: {
  appUrl: string;
  orgName: string;
  coachId?: string;
  coachEmail?: string | null;
}) {
  const [state, action] = useActionState<InviteState, FormData>(inviteWithLogin, { status: "idle" });
  const [formKey, setFormKey] = useState(0);

  if (state.status === "done") {
    const message = buildMessage(state, appUrl, orgName);
    return (
      <div className="stack anim-in">
        <div className="notice success" style={{ margin: 0 }}>
          <Icon name="checkCircle" size={17} />
          <div>
            {state.password
              ? `Login created for ${state.email}. Send them the message below.`
              : state.existingAccount
                ? `${state.email} already has an account. They'll join your club next time they sign in.`
                : `Invitation saved for ${state.email}.`}
          </div>
        </div>
        <textarea className="input wa-preview" readOnly value={message} style={{ minHeight: 190, fontFamily: "inherit" }} />
        <div className="row wrap">
          <a
            className="btn whatsapp"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openWhatsApp(null, message);
            }}
          >
            <Icon name="whatsapp" size={17} /> Send on WhatsApp
          </a>
          <CopyButton text={message} label="Copy message" />
        </div>
        {state.password ? (
          <p className="small muted">The password is only shown now. If it gets lost, they can use “Forgot password?” or you can create a new login.</p>
        ) : null}
        {!coachId ? (
          <button type="button" className="btn ghost small" onClick={() => setFormKey((k) => k + 1)}>
            Invite someone else
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="stack" key={formKey}>
      {state.status === "error" && state.message ? (
        <div className="notice error" style={{ margin: 0 }} role="alert">
          <Icon name="alert" size={17} />
          <div>{state.message}</div>
        </div>
      ) : null}
      {coachId ? (
        <>
          <input type="hidden" name="coach_id" value={coachId} />
          <p className="small muted">
            Let this coach log in to see their sessions, record office decisions, mark attendance and set their hours.
            {coachEmail ? ` Their login email will be ${coachEmail}.` : ""}
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span>Name</span>
            <input className="input" name="full_name" placeholder="Paolo Cruz" />
          </label>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" name="email" required placeholder="paolo@gmail.com" />
          </label>
          <div className="stack tight">
            <span className="label">Role</span>
            {(["agent", "coach", "admin"] as const).map((role) => (
              <label key={role} className="choice" style={{ padding: "10px 12px" }}>
                <input type="radio" name="role" value={role} defaultChecked={role === "agent"} />
                <div>
                  <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{role}</div>
                  <div className="small muted">{ROLE_HELP[role]}</div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
      <label className="check small">
        <input type="checkbox" name="create_login" defaultChecked />
        Create their login now with a temporary password
      </label>
      <SubmitButton variant="primary" icon="send" size={coachId ? "small" : undefined} disabled={Boolean(coachId && !coachEmail)} pendingText="Creating…">
        {coachId ? "Invite to log in" : "Invite"}
      </SubmitButton>
      {coachId && !coachEmail ? <span className="small faint">Add an email address to the coach's profile first.</span> : null}
    </form>
  );
}
