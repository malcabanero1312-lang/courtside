"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function DayStrip({ days }: { days: StripDay[] }) {
  const todayIndex = days.findIndex((d) => d.isToday);
  const [active, setActive] = useState(todayIndex >= 0 ? todayIndex : 0);
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
    if (window.innerWidth <= 860 && todayIndex >= 0) {
      jumpTo(todayIndex, false);
    }

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
      cancelAnimationFrame(frame);
    };
  }, [jumpTo, todayIndex]);

  return (
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
  );
}
