import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { Card, Flash, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { CalendarSyncButtons } from "@/components/calendar-sync-buttons";
import { createCalendarFeed, resetCalendarFeed } from "./actions";

export const metadata: Metadata = { title: "Sync to your calendar" };

export default async function CalendarSyncPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership } = await requireSession();
  const { data: feed, error } = await supabase
    .from("calendar_feeds")
    .select("token, last_fetched_at")
    .eq("membership_id", membership.id)
    .maybeSingle();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const httpsUrl = feed ? `${proto}://${host}/cal/${feed.token}.ics` : "";
  const isCoach = membership.role === "coach";

  return (
    <>
      <Flash params={params} />
      <div className="row small" style={{ marginBottom: 10 }}>
        <Link href="/calendar" className="muted row" style={{ gap: 4 }}>
          <Icon name="chevronLeft" size={15} /> Calendar
        </Link>
      </div>
      <PageHeader
        title="Sync to Google or iPhone calendar"
        subtitle={
          isCoach
            ? "Your sessions appear in your phone's calendar and stay up to date on their own."
            : `Every student's sessions at ${org.name} appear in your phone's calendar and stay up to date on their own.`
        }
      />
      <div className="grid main-side">
        <div className="stack">
          <Card padded>
            {error ? (
              <p className="small">
                The database needs update 0013 first. In Supabase → SQL Editor, run
                <code> supabase/migrations/0013_calendar_feeds_and_coach_sheet_names.sql</code>, then reload this page.
              </p>
            ) : !feed ? (
              <form action={createCalendarFeed} className="stack">
                <p style={{ margin: 0 }}>
                  Create your private calendar link once. After that, new bookings, changes and cancellations show up in your calendar
                  automatically — no duplicates, nothing to re-send.
                </p>
                <SubmitButton variant="primary" size="lg" icon="calendar" pendingText="Creating…">
                  Create my calendar link
                </SubmitButton>
              </form>
            ) : (
              <div className="stack">
                <CalendarSyncButtons httpsUrl={httpsUrl} />
                <div className="notice success" style={{ margin: 0 }}>
                  <Icon name="checkCircle" size={17} />
                  <div>
                    <strong>You only do this once.</strong> Your calendar keeps checking Courtside for changes, so new bookings, moved
                    times and cancellations update by themselves — the same event is updated, never copied.
                  </div>
                </div>
                <span className="small muted">
                  {feed.last_fetched_at
                    ? `Last checked by a calendar app: ${formatDateTime(feed.last_fetched_at, org.timezone)}.`
                    : "No calendar app has used this link yet."}
                </span>
              </div>
            )}
          </Card>

          {feed ? (
            <Card title="How quickly does it update?" padded>
              <ul className="small sync-list">
                <li>
                  <strong>iPhone:</strong> usually within an hour. To make it faster, open Settings → Calendar → Accounts → Fetch New Data
                  and choose “Every 15 minutes” or “Hourly”.
                </li>
                <li>
                  <strong>Mac Calendar:</strong> right-click the “Tennis” calendar → Get Info → Auto-refresh → Every 15 minutes.
                </li>
                <li>
                  <strong>Google Calendar:</strong> Google decides when to refresh — usually every few hours, sometimes up to a day. It
                  can't be forced, but nothing is ever duplicated.
                </li>
                <li>Sessions still waiting for the student or office show as “(Waiting)”. Cancelled sessions disappear.</li>
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="stack">
          <Card title="Keep it private" padded>
            <p className="small muted" style={{ marginTop: 0 }}>
              Anyone with this link can see the schedule. If it was shared by mistake, make a new one — the old link stops working
              immediately, and you subscribe again with the new link.
            </p>
            {feed ? (
              <form action={resetCalendarFeed}>
                <SubmitButton size="small" variant="ghost" confirmText="Make a new link? Calendars using the old link will stop updating.">
                  Make a new link
                </SubmitButton>
              </form>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}
