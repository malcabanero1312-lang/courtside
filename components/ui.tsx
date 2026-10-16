import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { STATUS_META } from "@/lib/format";
import type { AppointmentStatus } from "@/lib/types";

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </header>
  );
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`badge tone-${meta?.tone ?? "slate"}`} title={meta?.hint}>
      {meta?.label ?? status}
    </span>
  );
}

export function Card({
  title,
  actions,
  children,
  padded = false,
  className = ""
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="card-head">
          <div className="card-title">{title}</div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {padded ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function EmptyState({
  icon = "ball",
  title,
  body,
  action
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "success" | "error" | "warn" | "info"; children: ReactNode }) {
  const icon: IconName = tone === "success" ? "checkCircle" : tone === "info" ? "info" : "alert";
  return (
    <div className={`notice ${tone} anim-in`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={17} />
      <div>{children}</div>
    </div>
  );
}

export function Flash({ params }: { params: Record<string, string | string[] | undefined> }) {
  const notice = typeof params.notice === "string" ? params.notice : null;
  const error = typeof params.error === "string" ? params.error : null;
  return (
    <>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );
}

export function ButtonLink({
  href,
  children,
  variant,
  icon,
  size
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger" | "whatsapp";
  icon?: IconName;
  size?: "small" | "lg";
}) {
  return (
    <Link href={href} className={`btn ${variant ?? ""} ${size ?? ""}`}>
      {icon ? <Icon name={icon} size={size === "small" ? 15 : 17} /> : null}
      {children}
    </Link>
  );
}

export function Field({
  label,
  help,
  children,
  className
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className ?? ""}`}>
      <span>{label}</span>
      {children}
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export function CoachDot({ color }: { color?: string | null }) {
  return <span className="coach-dot" style={{ background: color ?? "var(--court-2)" }} />;
}

export function one(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] ?? "" : param ?? "";
}

export function Fold({
  title,
  children,
  open = false,
  padded = false,
  hint
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  padded?: boolean;
  hint?: ReactNode;
}) {
  return (
    <details className="card fold" open={open}>
      <summary className="card-head">
        <span className="card-title">{title}</span>
        <span className="row" style={{ gap: 8 }}>
          {hint ? <span className="small muted">{hint}</span> : null}
          <Icon name="chevronRight" size={16} className="fold-chevron" />
        </span>
      </summary>
      {padded ? <div className="card-body">{children}</div> : children}
    </details>
  );
}
