"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, sendPasswordReset, type AuthState } from "./actions";
import { SubmitButton } from "@/components/buttons";
import { Notice } from "@/components/ui";

type Mode = "signin" | "signup" | "reset";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [signInState, signInAction] = useActionState<AuthState, FormData>(signIn, { error: initialError });
  const [signUpState, signUpAction] = useActionState<AuthState, FormData>(signUp, {});
  const [resetState, resetAction] = useActionState<AuthState, FormData>(sendPasswordReset, {});

  const state = mode === "signin" ? signInState : mode === "signup" ? signUpState : resetState;
  const action = mode === "signin" ? signInAction : mode === "signup" ? signUpAction : resetAction;

  return (
    <div className="auth-card stack">
      <div>
        <div className="eyebrow">Courtside</div>
        <h2 className="display" style={{ fontSize: 30 }}>
          {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset password"}
        </h2>
        <p className="muted" style={{ marginTop: 6 }}>
          {mode === "signin"
            ? "Sign in to manage sessions, students and coaches."
            : mode === "signup"
              ? "Set up your club in a couple of minutes. If you were invited, use the same email address."
              : "We'll email you a link to choose a new password."}
        </p>
      </div>

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}

      <form action={action} className="stack" key={mode}>
        <input type="hidden" name="next" value={next} />
        {mode === "signup" ? (
          <label className="field">
            <span>Your name</span>
            <input className="input" name="full_name" autoComplete="name" required placeholder="Ana Reyes" />
          </label>
        ) : null}
        <label className="field">
          <span>Email</span>
          <input className="input" name="email" type="email" autoComplete="email" required placeholder="you@club.com" />
        </label>
        {mode !== "reset" ? (
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
            {mode === "signup" ? <small>At least 8 characters.</small> : null}
          </label>
        ) : null}
        <SubmitButton variant="primary" size="lg" block pendingText="Please wait…">
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </SubmitButton>
      </form>

      <div className="row between small">
        {mode === "signin" ? (
          <>
            <button type="button" className="btn ghost small" onClick={() => setMode("signup")}>
              Create an account
            </button>
            <button type="button" className="btn ghost small" onClick={() => setMode("reset")}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost small" onClick={() => setMode("signin")}>
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
