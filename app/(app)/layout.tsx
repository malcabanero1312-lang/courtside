import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession, ORG_COOKIE } from "@/lib/session";
import { MobileTab, NavLink } from "@/components/nav-link";
import { Icon, type IconName } from "@/components/icons";
import { initials } from "@/lib/format";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles: Role[];
  section: "work" | "manage";
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: "dashboard", roles: ["admin", "agent", "coach"], section: "work" },
  { href: "/calendar", label: "Calendar", icon: "calendar", roles: ["admin", "agent", "coach"], section: "work" },
  { href: "/appointments", label: "Appointments", icon: "list", roles: ["admin", "agent", "coach"], section: "work" },
  { href: "/students", label: "Students", icon: "users", roles: ["admin", "agent"], section: "work" },
  { href: "/coaches", label: "Coaches", icon: "whistle", roles: ["admin", "agent", "coach"], section: "manage" },
  { href: "/venues", label: "Venues & courts", icon: "court", roles: ["admin", "agent"], section: "manage" },
  { href: "/reports", label: "Reports", icon: "chart", roles: ["admin", "agent"], section: "manage" },
  { href: "/notifications", label: "Emails", icon: "mail", roles: ["admin", "agent"], section: "manage" },
  { href: "/team", label: "Team", icon: "shield", roles: ["admin"], section: "manage" },
  { href: "/settings", label: "Settings", icon: "settings", roles: ["admin"], section: "manage" }
];

async function switchOrg(formData: FormData) {
  "use server";
  const orgId = String(formData.get("org_id") ?? "");
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, membership, memberships, org } = await requireSession();
  const role = membership.role;
  const items = NAV.filter((item) => item.roles.includes(role));

  let attention = 0;
  if (role !== "coach") {
    const { data } = await supabase.rpc("dashboard_summary", { p_org: org.id });
    if (data) {
      const summary = data as Record<string, number>;
      attention =
        (summary.reschedule_requests ?? 0) +
        (summary.awaiting_overdue ?? 0) +
        (summary.to_close ?? 0) +
        (summary.office_not_sent ?? 0) +
        (summary.results_to_send ?? 0);
    }
  }

  const renderNav = (section: NavItem["section"]) =>
    items
      .filter((item) => item.section === section)
      .map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          icon={item.icon}
          label={item.label}
          count={item.href === "/dashboard" ? attention : undefined}
        />
      ));

  const roleLabel = role === "admin" ? "Admin" : role === "agent" ? "Agent" : "Coach";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="ball" size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">Courtside</div>
            <div className="brand-org">{org.name}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {renderNav("work")}
          <div className="nav-label">Manage</div>
          {renderNav("manage")}
        </nav>
        <div className="sidebar-footer">
          {memberships.length > 1 ? (
            <form action={switchOrg} className="row" style={{ padding: "0 4px" }}>
              <select
                name="org_id"
                defaultValue={org.id}
                className="input"
                style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", borderColor: "rgba(255,255,255,0.15)" }}
                aria-label="Switch organization"
              >
                {memberships.map((m) => (
                  <option key={m.org_id} value={m.org_id} style={{ color: "#000" }}>
                    {m.organization?.name}
                  </option>
                ))}
              </select>
              <button className="btn small" type="submit">Go</button>
            </form>
          ) : null}
          <div className="user-chip">
            <div className="avatar">{initials(membership.full_name || membership.email)}</div>
            <Link href="/account" style={{ minWidth: 0, flex: 1 }}>
              <div className="truncate" style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>
                {membership.full_name || membership.email}
              </div>
              <div className="small" style={{ color: "#9fbcae" }}>{roleLabel} · My account</div>
            </Link>
            <form action="/auth/signout" method="post">
              <button className="btn ghost small" type="submit" title="Sign out" style={{ color: "#c9dad1" }}>
                <Icon name="logout" size={16} />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        <div className="mobile-top">
          <div className="brand">
            <div className="brand-mark" style={{ width: 28, height: 28 }}>
              <Icon name="ball" size={16} />
            </div>
            <div className="brand-name truncate" style={{ fontSize: 17 }}>
              {org.name}
            </div>
          </div>
        </div>
        <main className="main">
          <span hidden data-rendered-at={new Date().toISOString()} />
          {children}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        <MobileTab href="/dashboard" icon="dashboard" label="Today" count={attention} />
        <MobileTab href="/calendar" icon="calendar" label="Calendar" />
        {role !== "coach" ? (
          <Link href="/appointments/new" className="bottom-nav-book" aria-label="Book a session">
            <Icon name="plus" size={24} />
          </Link>
        ) : (
          <MobileTab href="/appointments" icon="list" label="Sessions" />
        )}
        {role !== "coach" ? <MobileTab href="/students" icon="users" label="Students" /> : <MobileTab href="/coaches" icon="clock" label="My hours" />}
        <MobileTab href="/more" icon="columns" label="More" />
      </nav>
    </div>
  );
}
