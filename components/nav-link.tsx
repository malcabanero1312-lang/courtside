"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

export function NavLink({ href, icon, label, count }: { href: string; icon: IconName; label: string; count?: number }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/")) || pathname === href;
  return (
    <Link href={href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </Link>
  );
}

export function MobileTab({ href, icon, label, count }: { href: string; icon: IconName; label: string; count?: number }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link href={href} className={`bottom-tab ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
      <span className="bottom-tab-icon">
        <Icon name={icon} size={21} />
        {count ? <span className="bottom-tab-count">{count > 9 ? "9+" : count}</span> : null}
      </span>
      <span>{label}</span>
    </Link>
  );
}
