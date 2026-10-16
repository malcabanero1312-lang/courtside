"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setVisible(true);
      setWidth(18);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        setWidth((current) => (current < 85 ? current + (90 - current) * 0.12 : current));
      }, 180);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setWidth(100);
    const hide = window.setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 250);
    return () => window.clearTimeout(hide);
  }, [pathname, searchParams]);

  if (!visible) return null;
  return <div className="nav-progress" style={{ width: `${width}%` }} />;
}
