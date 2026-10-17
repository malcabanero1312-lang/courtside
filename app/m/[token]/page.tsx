import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cache } from "react";
import { createAnonClient } from "@/lib/supabase/admin";
import { Icon } from "@/components/icons";
import { datesLine, groupEntries, groupHeading, monthName, type RequestEntry } from "@/lib/regular";
import { MonthlyForm } from "./monthly-form";

export const dynamic = "force-dynamic";

interface MonthlyPage {
  found: boolean;
  status?: "sent" | "confirmed" | "change_requested" | "declined";
  entries?: RequestEntry[];
  month?: string;
  student_note?: string | null;
  answered_by?: string | null;
  student_first_name?: string;
  coach?: string | null;
  venue?: string | null;
  org_name?: string;
  brand_color?: string | null;
  contact_phone?: string | null;
}

const getMonthlyPage = cache(async (token: string): Promise<MonthlyPage> => {
  if (!token || token.length < 24 || token.length > 128) return { found: false };
  try {
    const supabase = createAnonClient();
    const { data } = await supabase.rpc("get_monthly_page", { p_token: token });
    return (data ?? { found: false }) as MonthlyPage;
  } catch {
    return { found: false };
  }
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const page = await getMonthlyPage(token);
  const base: Metadata = { robots: { index: false, follow: false } };
  if (!page.found || !page.month) return { ...base, title: "Your tennis schedule" };
  const title = page.status === "sent" ? `Tap to confirm your ${monthName(page.month)} tennis schedule` : `Your ${monthName(page.month)} tennis schedule`;
  const description = [page.coach ? `Coach ${page.coach}` : null, page.venue].filter(Boolean).join(" · ");
  return {
    ...base,
    title,
    description,
    openGraph: { title, description: description || "Confirm or request a change.", siteName: page.org_name ?? "Courtside", type: "website" }
  };
}

function Shell({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <main className="portal">
      <div className="portal-card anim-in">
        <div className="card" style={{ overflow: "hidden" }}>
          {children}
        </div>
        <p className="small faint" style={{ textAlign: "center", marginTop: 16 }}>
          Secure schedule page · Powered by Courtside
        </p>
      </div>
      <style>{`.portal-head{background:${color ?? "#12392c"}}`}</style>
    </main>
  );
}

const ANSWERED: Record<string, { title: string; body: string }> = {
  confirmed: { title: "Your schedule is confirmed", body: "Thank you! We'll book your courts with the office and let you know if anything changes." },
  change_requested: { title: "You asked for a change", body: "We'll check with the office and message you about your new schedule." },
  declined: { title: "You're not continuing this month", body: "Thanks for letting us know. Message us any time to come back." }
};

export default async function MonthlyPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await getMonthlyPage(token);

  if (!page.found || !page.month || !page.status) {
    return (
      <Shell>
        <div className="empty">
          <div className="empty-icon">
            <Icon name="info" size={24} />
          </div>
          <h3 className="display" style={{ fontSize: 22 }}>Link not found</h3>
          <p>This link isn't valid. Please use the latest message we sent you, or reply to us on WhatsApp.</p>
        </div>
      </Shell>
    );
  }

  const color = /^#[0-9a-fA-F]{6}$/.test(page.brand_color ?? "") ? (page.brand_color as string) : "#12392c";
  const month = monthName(page.month);
  const groups = groupEntries(page.entries ?? []);
  const contactHref =
    page.contact_phone && /^[0-9]{7,15}$/.test(page.contact_phone)
      ? `https://wa.me/${page.contact_phone}?text=${encodeURIComponent(`Hi ${page.org_name ?? ""}, I have a question about my ${month} tennis schedule.`)}`
      : null;

  return (
    <Shell color={color}>
      <div className="portal-head">
        <div className="small" style={{ opacity: 0.8, fontWeight: 600 }}>{page.org_name}</div>
        <h1 className="display" style={{ fontSize: 28, marginTop: 6 }}>
          Hi {page.student_first_name || "there"} 👋
        </h1>
        <p style={{ opacity: 0.85, marginTop: 4 }}>Here's your tennis schedule for {month}.</p>
      </div>
      <div className="card-body stack">
        <div className="stack tight">
          {groups.map((g) => (
            <div key={`${g.weekday}-${g.start}`} className="req-group">
              <strong>{groupHeading(g)}</strong>
              <span className="muted">{datesLine(g.dates)}</span>
            </div>
          ))}
          <div className="row small" style={{ color: "var(--ink-2)", fontSize: 15, marginTop: 4 }}>
            <Icon name="whistle" size={16} />
            {page.coach ? `Coach ${page.coach}` : "Your coach"}
            {page.venue ? <span className="muted"> · {page.venue}</span> : null}
          </div>
        </div>

        <div className="divider" />

        {page.status === "sent" ? (
          <MonthlyForm token={token} monthName={month} contactHref={contactHref} />
        ) : (
          <>
            <div className="empty" style={{ padding: "18px 8px" }}>
              <div className="empty-icon" style={{ background: "var(--ball)", color: "var(--court)" }}>
                <Icon name="check" size={26} />
              </div>
              <h3 className="display" style={{ fontSize: 22 }}>{ANSWERED[page.status]?.title}</h3>
              <p>{ANSWERED[page.status]?.body}</p>
              {page.student_note ? <p className="small">Your note: “{page.student_note}”</p> : null}
            </div>
            <div className="notice info" style={{ margin: 0 }}>
              <Icon name="info" size={17} />
              <div>
                Your answer has been recorded. If you have any concerns, please contact us directly.
                {contactHref ? (
                  <div style={{ marginTop: 10 }}>
                    <a className="btn whatsapp small" href={contactHref} target="_blank" rel="noopener noreferrer">
                      <Icon name="whatsapp" size={15} /> Message us on WhatsApp
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
