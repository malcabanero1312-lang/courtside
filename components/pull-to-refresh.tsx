"use client";

import { useEffect, useRef, useState } from "react";

const THRESHOLD = 80;
const MAX_PULL = 130;

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

export function PullToRefresh() {
  const [enabled, setEnabled] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!isStandalone()) return;
    setEnabled(true);
    document.documentElement.classList.add("standalone-app");

    const onStart = (event: TouchEvent) => {
      if (window.scrollY > 0 || event.touches.length !== 1 || insideScrolledArea(event.target)) {
        startY.current = null;
        return;
      }
      startY.current = event.touches[0].clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const distance = event.touches[0].clientY - startY.current;
      if (distance <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const eased = Math.min(MAX_PULL, distance * 0.5);
      pullRef.current = eased;
      setPull(eased);
    };

    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        window.setTimeout(() => window.location.reload(), 150);
      } else {
        pullRef.current = 0;
        setPull(0);
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

  const ready = pull >= THRESHOLD;
  return (
    <div
      className="ptr"
      style={{ transform: `translate(-50%, ${pull - 52}px)`, opacity: Math.min(1, pull / 40) }}
      aria-live="polite"
    >
      <div className={`ptr-circle ${refreshing ? "spinning" : ""}`} style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)` }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
        </svg>
      </div>
      <span className="sr-only">{refreshing ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
