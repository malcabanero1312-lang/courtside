"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[courtside:page]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="card card-pad stack" style={{ maxWidth: 560 }}>
      <h1 className="display" style={{ fontSize: 26 }}>This page couldn't load</h1>
      <p className="muted">
        Something went wrong on our side. Your data is safe. Try again, and if it keeps happening, share this code with
        your admin: <code>{error.digest ?? "no-code"}</code>
      </p>
      <div className="row">
        <button className="btn primary" type="button" onClick={() => reset()}>
          Try again
        </button>
        <a className="btn" href="/dashboard">
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
