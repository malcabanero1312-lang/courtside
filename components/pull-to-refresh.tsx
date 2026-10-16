"use client";

import { useEffect, useRef, useState } from "react";

const THRESHOLD = 70;
const MAX_PULL = 110;
const START_AFTER = 12;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function insideScrolledArea(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      return true;
    }
    if (node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

function setOffset(px: number, animate: boolean) {
  const root = document.documentElement;
  root.style.setProperty("--ptr-offset", `${px}px`);
  root.classList.toggle("ptr-animating", animate);
}

export function PullToRefresh() {
  const [enabled, setEnabled] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef<number>(0);
  const readyRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isStandalone()) return;
    setEnabled(true);
    document.documentElement.classList.add("standalone-app");

    const reset = () => {
      pullRef.current = 0;
      readyRef.current = false;
      setPull(0);
      setOffset(0, true);
    };

    const onStart = (event: TouchEvent) => {
      if (window.scrollY > 0 || event.touches.length !== 1 || insideScrolledArea(event.target)) {
        startY.current = null;
        return;
      }
      startY.current = event.touches[0].clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const distance = event.touches[0].clientY - startY.current - START_AFTER;
      if (distance <= 0 || window.scrollY > 0) {
        if (pullRef.current !== 0) reset();
        return;
      }
      const eased = Math.min(MAX_PULL, distance * 0.45);
      pullRef.current = eased;
      setPull(eased);
      setOffset(eased * 0.6, false);
      const ready = eased >= THRESHOLD;
      if (ready && !readyRef.current && "vibrate" in navigator) {
        navigator.vibrate(8);
      }
      readyRef.current = ready;
    };

    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        setOffset(48, true);
        window.setTimeout(() => window.location.reload(), 250);
      } else {
        reset();
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (!enabled || (pull === 0 && !refreshing)) return null;

  const progress = Math.min(1, pull / THRESHOLD);
  const ready = progress >= 1;

  return (
    <div className="ptr" style={{ opacity: Math.min(1, pull / 30) }} aria-live="polite">
      <div className={`ptr-circle ${ready ? "ready" : ""}`}>
        {refreshing ? (
          <span className="ptr-spinner" />
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transform: `rotate(${progress * 180}deg)`, transition: "transform 0.12s ease" }}
          >
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        )}
      </div>
      <span className="ptr-label">{refreshing ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
