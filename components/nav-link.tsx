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
