"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

export function CalendarSyncButtons({ httpsUrl }: { httpsUrl: string }) {
  const [copied, setCopied] = useState(false);
  const webcal = httpsUrl.replace(/^https?:\/\//, "webcal://");
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(httpsUrl);
    } catch {
      window.prompt("Copy this link", httpsUrl);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="sync-buttons">
      <a className="sync-btn apple" href={webcal}>
        <span className="sync-btn-icon">
          <Icon name="calendar" size={20} />
        </span>
        <span>
          <strong>iPhone / Mac Calendar</strong>
          <small>Tap, then “Subscribe”</small>
        </span>
      </a>
      <a className="sync-btn google" href={google} target="_blank" rel="noopener noreferrer">
        <span className="sync-btn-icon">
          <Icon name="calendar" size={20} />
        </span>
        <span>
          <strong>Google Calendar</strong>
          <small>Opens Google, then “Add”</small>
        </span>
      </a>
      <button type="button" className="btn small sync-copy" onClick={copy}>
        <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Link copied" : "Copy link (for other calendar apps)"}
      </button>
    </div>
  );
}
