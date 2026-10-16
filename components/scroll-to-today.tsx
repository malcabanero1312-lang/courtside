"use client";

import { useEffect } from "react";

export function ScrollToToday() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".week-scroll");
    const today = scroller?.querySelector<HTMLElement>('[data-today="1"]');
    if (scroller && today && window.innerWidth <= 860 && scroller.scrollWidth > scroller.clientWidth) {
      scroller.scrollLeft = today.offsetLeft - 8;
    }
  }, []);
  return null;
}
