"use client";

import { useEffect, useState } from "react";

const WARM_KEY = "courtside.lastWarm";
const WARM_EVERY_MS = 10 * 60 * 1000;
const WARM_URLS = ["/dashboard", "/calendar", "/appointments", "/students", "/coaches", "/more", "/account"];

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function savedAtLabel(): string | null {
  const marker = document.querySelector<HTMLElement>("[data-rendered-at]");
  const iso = marker?.dataset.renderedAt;
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

export function OfflineManager() {
  const [online, setOnline] = useState(true);
  const [backOnline, setBackOnline] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const warm = () => {
      if (!navigator.onLine || !("serviceWorker" in navigator)) return;
      if (!document.querySelector("[data-rendered-at]")) return;
      const last = Number(readStorage(WARM_KEY) ?? 0);
      if (Date.now() - last < WARM_EVERY_MS) return;
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.active?.postMessage({ type: "warm", urls: WARM_URLS });
          writeStorage(WARM_KEY, String(Date.now()));
        })
        .catch(() => undefined);
    };

    const goOffline = () => {
      setOnline(false);
      setBackOnline(false);
      setSavedAt(savedAtLabel());
    };
    const goOnline = () => {
      setOnline(true);
      setBackOnline(true);
      warm();
    };

    if (!navigator.onLine) goOffline();
    else window.setTimeout(warm, 3000);

    const onClick = (event: MouseEvent) => {
      if (navigator.onLine || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/")) {
        event.preventDefault();
        event.stopPropagation();
        setToast("You're offline. Connect to the internet to download this.");
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      window.location.href = url.toString();
    };

    const onSubmit = (event: Event) => {
      if (navigator.onLine) return;
      const form = event.target as HTMLFormElement | null;
      if (form && form.method.toLowerCase() === "get" && !form.getAttribute("action")?.startsWith("/auth")) {
        event.preventDefault();
        event.stopPropagation();
        const params = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
        window.location.href = `${form.getAttribute("action") || window.location.pathname}?${params.toString()}`;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setToast("You're offline, so this wasn't saved. Connect to the internet and try again.");
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <>
      {!online ? (
        <div className="net-banner offline" role="status">
          <strong>You're offline.</strong>{" "}
          {savedAt ? `Showing what was saved at ${savedAt}.` : "Showing the last saved version."} Connect to the internet to see updates
          and save changes.
        </div>
      ) : backOnline ? (
        <div className="net-banner online" role="status">
          <span>
            <strong>Back online.</strong> Refresh to get the latest updates.
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" onClick={() => window.location.reload()}>
              Refresh
            </button>
            <button type="button" className="btn small ghost" aria-label="Dismiss" onClick={() => setBackOnline(false)}>
              ✕
            </button>
          </span>
        </div>
      ) : null}
      {toast ? (
        <div className="net-toast" role="alert">
          {toast}
        </div>
      ) : null}
    </>
  );
}
