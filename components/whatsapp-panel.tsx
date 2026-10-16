"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { CopyButton } from "@/components/buttons";
import { logWhatsApp } from "@/app/(app)/appointments/actions";
import { whatsappLink } from "@/lib/whatsapp";

interface Message {
  key: string;
  name: string;
  text: string;
}

export function WhatsAppPanel({
  appointmentId,
  phone,
  messages,
  defaultKey,
  highlight,
  studentName
}: {
  appointmentId: string;
  phone: string | null;
  messages: Message[];
  defaultKey: string;
  highlight?: boolean;
  studentName: string;
}) {
  const router = useRouter();
  const [key, setKey] = useState(defaultKey);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(messages.map((m) => [m.key, m.text]))
  );
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const text = drafts[key] ?? "";
  const href = phone ? whatsappLink(phone, text) : "#";

  return (
    <section
      className="card"
      id="whatsapp"
      style={highlight ? { borderColor: "#1f8f4e", boxShadow: "0 0 0 3px rgba(31,143,78,0.15)" } : undefined}
    >
      <div className="card-head">
        <div className="card-title row">
          <span style={{ color: "#1f8f4e", display: "inline-flex" }}>
            <Icon name="whatsapp" size={18} />
          </span>
          Message {studentName.split(" ")[0]} on WhatsApp
        </div>
        <select
          className="input"
          style={{ width: "auto", height: 32 }}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setOpened(false);
          }}
          aria-label="Message template"
        >
          {messages.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="card-body stack">
        <textarea
          className="input wa-preview"
          style={{ minHeight: 200, fontFamily: "inherit" }}
          value={text}
          onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
          aria-label="Message text"
        />
        {error ? <div className="field-error">{error}</div> : null}
        {done ? (
          <div className="notice success" style={{ margin: 0 }}>
            <Icon name="checkCircle" size={17} />
            <div>Recorded as sent. You'll see the student's answer here as soon as they reply.</div>
          </div>
        ) : null}
        {phone ? (
          <div className="row wrap">
            <a
              className="btn whatsapp lg"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setOpened(true);
                setError(null);
                logWhatsApp(appointmentId, "opened", key).catch(() => undefined);
              }}
            >
              <Icon name="whatsapp" size={18} />
              Open WhatsApp
            </a>
            <CopyButton text={text} label="Copy text" />
            <span className="small muted">To +{phone}</span>
          </div>
        ) : (
          <div className="notice warn" style={{ margin: 0 }}>
            <Icon name="phone" size={17} />
            <div>
              This student has no WhatsApp number. Add one on their profile, or copy the message and send it another way.
              <div style={{ marginTop: 8 }}>
                <CopyButton text={text} label="Copy message" />
              </div>
            </div>
          </div>
        )}
        {opened && !done ? (
          <div className="card card-pad anim-in" style={{ background: "var(--surface-2)" }}>
            <div className="row between wrap">
              <div>
                <div style={{ fontWeight: 650 }}>Did you press Send in WhatsApp?</div>
                <div className="small muted">We can't see inside WhatsApp, so please confirm it went out.</div>
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await logWhatsApp(appointmentId, "sent", key);
                    if (result.ok) {
                      setDone(true);
                      router.refresh();
                    } else {
                      setError(result.error ?? "Couldn't record that. Please try again.");
                    }
                  })
                }
              >
                <Icon name="check" size={16} />
                {pending ? "Saving…" : "Yes, mark as sent"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
