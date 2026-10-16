"use client";

import { CopyButton } from "@/components/buttons";
import { Icon } from "@/components/icons";
import { logLinkCopied } from "@/app/(app)/appointments/actions";

export function ResponseLinkBox({ appointmentId, link }: { appointmentId: string; link: string }) {
  return (
    <div className="stack tight">
      <p className="small muted">
        The student uses this page to confirm, decline or ask for another time. It's already included in the WhatsApp
        messages.
      </p>
      <input className="input small" value={link} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Response link" />
      <div className="row">
        <CopyButton text={link} label="Copy link" onCopied={() => logLinkCopied(appointmentId).catch(() => undefined)} />
        <a className="btn small ghost" href={link} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={15} /> Preview
        </a>
      </div>
    </div>
  );
}
