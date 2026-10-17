import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getPortalData, portalWhen } from "@/lib/portal";
import { getSession } from "@/lib/session";
import { durationLabel, formatDate, formatTimeRange, minutesBetween, STATUS_META } from "@/lib/format";
import type { AppointmentStatus } from "@/lib/types";
import { Icon } from "@/components/icons";
import { ResponseForm } from "./response-form";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const page = await getPortalData(token);
  const base: Metadata = { robots: { index: false, follow: false } };
  if (!page.found) return { ...base, title: "Your tennis session" };
  const when = portalWhen(page);
  const answerable = page.state === "open";
  const title = answerable ? "Tap to confirm your tennis session" : "Your tennis session";
  const description = [
    `${when.day} · ${when.time}`,
    page.coach ? `Coach ${page.coach}` : null,
    [page.venue, page.court].filter(Boolean).join(", ") || null
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    ...base,
    title,
    description,
    openGraph: {
      title,
      description: answerable ? `${description}. Confirm, decline or ask for another time.` : description,
      siteName: page.org_name ?? "Courtside",
      type: "website"
    },
    twitter: { card: "summary_large_image", title, description }
  };
}
export const dynamic = "force-dynamic";


const ANSWERED: Partial<Record<AppointmentStatus, { title: string; body: string }>> = {
  pending_approval: {
    title: "You confirmed this session",
    body: "Thank you! The club office is finalising your booking, and we'll message you once it's approved."
  },
  confirmed: {
    title: "Your session is confirmed",
    body: "Thank you! Your booking has been approved by the club. See you on court."
  },
  declined: {
    title: "You told us you can't make it",
    body: "Thanks for letting us know. We've released this time slot."
  },
  reschedule_requested: {
    title: "You asked for a different time",
    body: "We'll message you shortly with a new time based on your preferences."
  }
};

function ContactNote({ href }: { href: string | null }) {
  return (
    <div className="notice info" style={{ margin: 0 }}>
      <Icon name="info" size={17} />
      <div>
        Your answer has been recorded and can't be changed online. If you have any concerns or need to change something,
        please contact us directly.
        {href ? (
          <div style={{ marginTop: 10 }}>
            <a className="btn whatsapp small" href={href} target="_blank" rel="noopener noreferrer">
              <Icon name="whatsapp" size={15} /> Message us on WhatsApp
            </a>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>You can simply reply to our WhatsApp message.</div>
        )}
      </div>
    </div>
  );
}

function Shell({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <main className="portal">
      <div className="portal-card anim-in">
        <div className="card" style={{ overflow: "hidden" }}>
          {children}
        </div>
        <p className="small faint" style={{ textAlign: "center", marginTop: 16 }}>
          Secure booking page · Powered by Courtside
        </p>
      </div>
      <style>{`.portal-head{background:${color ?? "#12392c"}}`}</style>
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="info" size={24} />
      </div>
      <h3 className="display" style={{ fontSize: 22 }}>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await getPortalData(token);

  if (!page.found || !page.starts_at || !page.ends_at || !page.timezone || !page.status) {
    return (
      <Shell>
        <Message title="Link not found" body="This link isn't valid. Please use the latest message we sent you, or reply to us on WhatsApp." />
      </Shell>
    );
  }

  const session = await getSession().catch(() => null);
  const viewingAsStaff = Boolean(session?.membership);

  const tz = page.timezone;
  const status = page.status;
  const meta = STATUS_META[status];
  const color = /^#[0-9a-fA-F]{6}$/.test(page.brand_color ?? "") ? page.brand_color : "#12392c";
  const contactHref =
    page.contact_phone && /^[0-9]{7,15}$/.test(page.contact_phone)
      ? `https://wa.me/${page.contact_phone}?text=${encodeURIComponent(
          `Hi ${page.org_name ?? ""}, I have a question about my tennis booking ${page.reference ?? ""} on ${formatDate(page.starts_at, tz)}.`
        )}`
      : null;
  const mapsHref =
    page.maps_url && /^https?:\/\//.test(page.maps_url)
      ? page.maps_url
      : page.venue_address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${page.venue ?? ""} ${page.venue_address}`)}`
        : null;

  return (
    <Shell color={color}>
      <div className="portal-head">
        <div className="small" style={{ opacity: 0.8, fontWeight: 600 }}>{page.org_name}</div>
        <h1 className="display" style={{ fontSize: 28, marginTop: 6 }}>
          Hi {page.student_first_name || "there"} 👋
        </h1>
        <p style={{ opacity: 0.85, marginTop: 4 }}>Here are the details of your tennis session.</p>
      </div>

      <div className="card-body stack">
        {viewingAsStaff ? (
          <div className="notice warn" style={{ margin: 0 }}>
            <Icon name="alert" size={17} />
            <div>You're signed in as staff. Answers you submit here will be recorded as the student's response.</div>
          </div>
        ) : null}

        <div className="stack tight">
          <div className="row between wrap">
            <div className="display" style={{ fontSize: 22 }}>{formatDate(page.starts_at, tz)}</div>
            <span className={`badge tone-${meta.tone}`}>{meta.label}</span>
          </div>
          <div className="row small" style={{ color: "var(--ink-2)", fontSize: 15 }}>
            <Icon name="clock" size={16} />
            {formatTimeRange(page.starts_at, page.ends_at, tz)} · {durationLabel(minutesBetween(page.starts_at, page.ends_at))}
          </div>
          <div className="row small" style={{ color: "var(--ink-2)", fontSize: 15 }}>
            <Icon name="pin" size={16} />
            <span>
              {page.venue}
              {page.court ? `, ${page.court}` : ""}
              {page.venue_address ? <span className="muted"> — {page.venue_address}</span> : null}
            </span>
          </div>
          <div className="row small" style={{ color: "var(--ink-2)", fontSize: 15 }}>
            <Icon name="whistle" size={16} />
            Coach {page.coach}
            {page.session_type ? <span className="muted"> · {page.session_type}</span> : null}
          </div>
          <div className="row wrap" style={{ marginTop: 6 }}>
            {mapsHref ? (
              <a className="btn small" href={mapsHref} target="_blank" rel="noopener noreferrer">
                <Icon name="pin" size={15} /> Directions
              </a>
            ) : null}
            <a className="btn small" href={`/r/${token}/calendar`}>
              <Icon name="calendar" size={15} /> Add to calendar
            </a>
          </div>
        </div>

        <div className="divider" />

        {page.state === "open" ? (
          <>
            {status === "confirmed" ? (
              <div className="notice success" style={{ margin: 0 }}>
                <Icon name="checkCircle" size={17} />
                <div>Your booking is confirmed by the club. If something changes, let us know below.</div>
              </div>
            ) : status === "pending_approval" ? (
              <div className="notice info" style={{ margin: 0 }}>
                <Icon name="clock" size={17} />
                <div>
                  Thanks for confirming! The club office is finalising your booking, and we'll message you once it's approved. If
                  something changes, let us know below.
                </div>
              </div>
            ) : status === "reschedule_requested" ? (
              <div className="notice info" style={{ margin: 0 }}>
                <Icon name="clock" size={17} />
                <div>
                  We've received your request for a new time{page.student_note ? `: “${page.student_note}”` : ""}. We'll message you soon.
                </div>
              </div>
            ) : status === "declined" ? (
              <div className="notice info" style={{ margin: 0 }}>
                <Icon name="info" size={17} />
                <div>You declined this session. Changed your mind? You can still confirm below if the time is free.</div>
              </div>
            ) : null}
            <ResponseForm token={token} currentStatus={status} contactHref={contactHref} />
          </>
        ) : page.state === "answered" ? (
          <>
            <div className="empty" style={{ padding: "18px 8px" }}>
              <div className="empty-icon" style={{ background: "var(--ball)", color: "var(--court)" }}>
                <Icon name="check" size={26} />
              </div>
              <h3 className="display" style={{ fontSize: 22 }}>{ANSWERED[status]?.title ?? "We've received your answer"}</h3>
              <p>{ANSWERED[status]?.body ?? "Thank you for letting us know."}</p>
              {page.student_note ? <p className="small">Your note: “{page.student_note}”</p> : null}
            </div>
            <ContactNote href={contactHref} />
          </>
        ) : page.state === "expired" ? (
          <Message title="This link has expired" body="Please message us on WhatsApp and we'll help you right away." />
        ) : page.state === "revoked" ? (
          <Message title="This link was replaced" body="Your booking changed. Please use the most recent message we sent you." />
        ) : page.state === "past" ? (
          <Message title="This session has passed" body="Thanks for training with us. Message us any time to book again." />
        ) : (
          <Message
            title={
              status === "cancelled"
                ? "This session was cancelled"
                : status === "not_approved"
                  ? "The club couldn't confirm this time"
                  : "This booking can't be changed online"
            }
            body={
              status === "not_approved"
                ? "We're sorry. We'll message you to find another time that works."
                : "Please message us on WhatsApp if you have any questions."
            }
          />
        )}

        {page.cancellation_policy ? <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{page.cancellation_policy}</p> : null}
        <p className="small faint">Reference {page.reference}</p>
      </div>
    </Shell>
  );
}
