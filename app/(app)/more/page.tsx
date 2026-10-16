import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Icon, type IconName } from "@/components/icons";
import { initials } from "@/lib/format";
import type { Role } from "@/lib/types";

export const metadata: Metadata = { title: "More" };

const LINKS: { href: string; label: string; hint: string; icon: IconName; roles: Role[] }[] = [
  { href: "/appointments", label: "Appointments list", hint: "Search, filter, bulk actions, export", icon: "list", roles: ["admin", "agent"] },
  { href: "/coaches", label: "Coaches", hint: "Working hours, breaks, time off", icon: "whistle", roles: ["admin", "agent"] },
  { href: "/venues", label: "Venues & courts", hint: "Opening hours and closures", icon: "court", roles: ["admin", "agent"] },
  { href: "/reports", label: "Reports", hint: "Bookings, confirmations, coach hours", icon: "chart", roles: ["admin", "agent"] },
  { href: "/notifications", label: "Emails", hint: "Automatic email log", icon: "mail", roles: ["admin", "agent"] },
  { href: "/team", label: "Team", hint: "Invite agents and coaches", icon: "shield", roles: ["admin"] },
  { href: "/settings", label: "Settings", hint: "Rules, office contact, message templates", icon: "settings", roles: ["admin"] },
  { href: "/account", label: "My account", hint: "Your name, password, install the app", icon: "user", roles: ["admin", "agent", "coach"] }
];

export default async function MorePage() {
  const { membership, org } = await requireSession();
  const links = LINKS.filter((link) => link.roles.includes(membership.role));

  return (
    <div className="stack">
      <div className="card card-pad row">
        <div className="avatar" style={{ width: 44, height: 44, fontSize: 15 }}>
          {initials(membership.full_name || membership.email)}
        </div>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>{membership.full_name || membership.email}</div>
          <div className="small muted" style={{ textTransform: "capitalize" }}>
            {membership.role} · {org.name}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="list">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="list-item">
              <span className="empty-icon" style={{ width: 36, height: 36, borderRadius: 10, margin: 0 }}>
                <Icon name={link.icon} size={18} />
              </span>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{link.label}</div>
                <div className="small muted">{link.hint}</div>
              </div>
              <Icon name="chevronRight" size={16} />
            </Link>
          ))}
        </div>
      </div>

      <form action="/auth/signout" method="post">
        <button className="btn block danger" type="submit">
          <Icon name="logout" size={16} /> Sign out
        </button>
      </form>
    </div>
  );
}
