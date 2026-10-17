"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface StripDay {
  date: string;
  weekday: string;
  dayNumber: number;
  count: number;
  isToday: boolean;
  isPast?: boolean;
}

function columns(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>(".week-day"));
}

function offsetOf(scroller: HTMLElement, column: HTMLElement): number {
  return column.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
}

export function DayStrip({
  days,
  initialDay = null,
  prevWeekHref,
  nextWeekHref
}: {
  days: StripDay[];
  initialDay?: number | null;
  prevWeekHref?: string;
  nextWeekHref?: string;
}) {
  const router = useRouter();
  const todayIndex = days.findIndex((d) => d.isToday);
  const startIndex = initialDay ?? (todayIndex >= 0 ? todayIndex : -1);
  const [active, setActive] = useState(startIndex >= 0 ? startIndex : 0);
  const [edge, setEdge] = useState<"prev" | "next" | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const jumping = useRef(false);

  const jumpTo = useCallback((index: number, smooth: boolean) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const column = columns(scroller)[index];
    if (!column) return;
    jumping.current = smooth;
    setActive(index);
    scroller.scrollTo({ left: offsetOf(scroller, column), behavior: smooth ? "smooth" : "auto" });
    if (smooth) window.setTimeout(() => (jumping.current = false), 450);
  }, []);

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".week-scroll");
    if (!scroller) return;
    scrollerRef.current = scroller;
    if (window.innerWidth <= 860 && startIndex >= 0) {
      jumpTo(startIndex, false);
    }

    let startX = 0;
    let startY = 0;
    let atStart = false;
    let atEnd = false;
    let tracking = false;
    const onTouchStart = (event: TouchEvent) => {
      if (window.innerWidth > 860 || event.touches.length !== 1) return;
      tracking = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      atStart = scroller.scrollLeft <= 4;
      atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (Math.abs(dx) < Math.abs(dy)) {
        setEdge(null);
        return;
      }
      if (atEnd && nextWeekHref && dx < -70) setEdge("next");
      else if (atStart && prevWeekHref && dx > 70) setEdge("prev");
      else setEdge(null);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      setEdge(null);
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (atEnd && dx < 0 && nextWeekHref) router.push(nextWeekHref);
      else if (atStart && dx > 0 && prevWeekHref) router.push(prevWeekHref);
    };
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });

    let frame = 0;
    const onScroll = () => {
      if (jumping.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cols = columns(scroller);
        let best = 0;
        let bestDistance = Infinity;
        cols.forEach((col, i) => {
          const distance = Math.abs(offsetOf(scroller, col) - scroller.scrollLeft);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        });
        setActive(best);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(frame);
    };
  }, [jumpTo, startIndex, nextWeekHref, prevWeekHref, router]);

  return (
    <>
      {edge ? (
        <div className={`week-edge-hint ${edge}`} aria-hidden>
          {edge === "next" ? "Release for next week ›" : "‹ Release for previous week"}
        </div>
      ) : null}
      <div className="day-strip" role="tablist" aria-label="Days of the week">
        {days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={`day-chip ${index === active ? "active" : ""} ${day.isToday ? "today" : ""} ${day.isPast ? "past" : ""}`}
            onClick={() => jumpTo(index, true)}
          >
            <span className="day-chip-name">{day.weekday}</span>
            <span className="day-chip-num">{day.dayNumber}</span>
            <span className="day-chip-count">{day.count > 0 ? day.count : ""}</span>
          </button>
        ))}
      </div>
    </>
  );
}
