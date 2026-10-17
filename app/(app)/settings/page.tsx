import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import type { SessionType } from "@/lib/types";
import { TIMEZONES } from "@/lib/format";
import { isEmailConfigured } from "@/lib/env";
import { Card, Flash, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { addSessionType, updateOrganization, updateSessionType } from "./actions";
import { updateCourt, updateVenueBasics } from "../venues/actions";
import { venueColor } from "@/lib/venue-colors";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org } = await requireSession(["admin"]);
  const { data } = await supabase.from("session_types").select("*").eq("org_id", org.id).order("name");
  const types = (data ?? []) as SessionType[];
  const [venuesRes, courtsRes] = await Promise.all([
    supabase.from("venues").select("*").eq("org_id", org.id).order("name"),
    supabase.from("courts").select("*").eq("org_id", org.id).order("name")
  ]);
  const venues = (venuesRes.data ?? []) as { id: string; name: string; color?: string | null; is_active: boolean }[];
  const courts = (courtsRes.data ?? []) as { id: string; venue_id: string; name: string; alt_name?: string | null; surface: string | null }[];
  const zones = TIMEZONES.includes(org.timezone) ? TIMEZONES : [org.timezone, ...TIMEZONES];

  return (
    <>
      <Flash params={params} />
      <PageHeader
        title="Settings"
        subtitle="Business rules for your whole organization."
        actions={
          <Link className="btn" href="/settings/templates">
            <Icon name="mail" size={16} /> Message templates
          </Link>
        }
      />
      <div className="grid main-side">
        <form action={updateOrganization} className="stack">
          <Card title="Organization" padded>
            <div className="form-grid">
              <label className="field span-2">
                <span>Name</span>
                <input className="input" name="name" defaultValue={org.name} required />
              </label>
              <label className="field">
                <span>Time zone</span>
                <select className="input" name="timezone" defaultValue={org.timezone}>
                  {zones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Phone country code</span>
                <input className="input" name="default_country_code" defaultValue={org.default_country_code} inputMode="numeric" />
              </label>
              <label className="field">
                <span>Brand colour</span>
                <input className="input" type="color" name="brand_color" defaultValue={org.brand_color} style={{ padding: 4 }} />
                <small>Used on the student response page.</small>
              </label>
              <label className="field">
                <span>Number students can message (WhatsApp)</span>
                <input
                  className="input"
                  name="contact_phone"
                  defaultValue={org.contact_phone ? `+${org.contact_phone}` : ""}
                  placeholder="0917 123 4567"
                  inputMode="tel"
                />
                <small>Shown on the student page after they answer, for questions or changes.</small>
              </label>
              <label className="field">
                <span>Reply-to email</span>
                <input className="input" type="email" name="reply_to_email" defaultValue={org.reply_to_email ?? ""} placeholder="bookings@yourclub.com" />
                <small>Where student replies to emails go.</small>
              </label>
            </div>
          </Card>

          <Card title="Office approval" padded>
            <div className="stack">
              <p className="small muted">
                After a student confirms, the coach or agent sends the booking to the office for approval. Add the office's
                WhatsApp number to open the chat in one tap; leave it empty to copy the message instead.
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>Office contact name</span>
                  <input className="input" name="office_name" defaultValue={org.office_name ?? ""} placeholder="e.g. Club Office or Ms. Reyes" />
                  <small>Used in the greeting: “Hi …”.</small>
                </label>
                <label className="field">
                  <span>Office WhatsApp number</span>
                  <input
                    className="input"
                    name="office_phone"
                    defaultValue={org.office_phone ? `+${org.office_phone}` : ""}
                    placeholder="0917 123 4567"
                    inputMode="tel"
                  />
                </label>
              </div>
            </div>
          </Card>

          <Card title="Scheduling" padded>
            <div className="form-grid">
              <label className="field">
                <span>Default session length (minutes)</span>
                <input className="input" type="number" name="default_duration_minutes" min={15} max={480} defaultValue={org.default_duration_minutes} />
              </label>
              <label className="field">
                <span>Time slot step</span>
                <select className="input" name="slot_step_minutes" defaultValue={String(org.slot_step_minutes)}>
                  {[10, 15, 20, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      Every {n} minutes
                    </option>
                  ))}
                </select>
                <small>Used for suggested free times.</small>
              </label>
              <label className="field">
                <span>Ask regular students to confirm (days before the lesson)</span>
                <input className="input" type="number" name="confirm_days_before" min={0} max={30} defaultValue={org.confirm_days_before ?? 2} />
                <small>Used when importing the office sheet. Sessions appear in To do on that day.</small>
              </label>
              <label className="field">
                <span>Follow up when no reply after (hours)</span>
                <input className="input" type="number" name="follow_up_after_hours" min={1} max={168} defaultValue={org.follow_up_after_hours} />
              </label>
              <label className="field">
                <span>Student links stay valid for (days)</span>
                <input className="input" type="number" name="response_link_days" min={1} max={90} defaultValue={org.response_link_days} />
                <small>Links also stop working a day after the session.</small>
              </label>
              <label className="field span-2">
                <span>Cancellation policy (shown to students)</span>
                <textarea
                  className="input"
                  name="cancellation_policy"
                  defaultValue={org.cancellation_policy ?? ""}
                  placeholder="e.g. Please give at least 24 hours' notice for changes. Late cancellations may be charged."
                />
              </label>
            </div>
          </Card>

          <Card title="Email notifications" padded>
            <div className="stack">
              {!isEmailConfigured() ? (
                <div className="notice info" style={{ margin: 0 }}>
                  <Icon name="info" size={17} />
                  <div>Email sending isn't connected yet. These settings take effect once it is (see SETUP.md).</div>
                </div>
              ) : null}
              <label className="check">
                <input type="checkbox" name="notify_student_email" defaultChecked={org.notify_student_email} />
                Email students: confirmations, cancellations, new times and reminders
              </label>
              <label className="field" style={{ maxWidth: 320 }}>
                <span>Send reminders this many hours before</span>
                <input className="input" type="number" name="reminder_hours_before" min={0} max={168} defaultValue={org.reminder_hours_before} />
                <small>0 turns reminders off.</small>
              </label>
              <label className="check">
                <input type="checkbox" name="notify_coach_email" defaultChecked={org.notify_coach_email} />
                Email coaches when students respond, cancel or are moved
              </label>
              <label className="check">
                <input type="checkbox" name="notify_agent_email" defaultChecked={org.notify_agent_email} />
                Email the handling agent when a student responds
              </label>
            </div>
          </Card>
          <div className="form-actions">
            <SubmitButton variant="primary" size="lg">Save settings</SubmitButton>
          </div>
        </form>

        <aside className="stack">
          <Card
            title="Venues & courts"
            actions={
              <Link className="btn small ghost" href="/venues">
                Move / delete
              </Link>
            }
          >
            <div className="card-body stack">
              <span className="small muted">Renaming here updates every booking, student schedule and calendar entry at once.</span>
              {venues.length === 0 ? <span className="small faint">No venues yet — add one on the Venues & courts page.</span> : null}
              {venues.map((venue) => {
                const color = venueColor(venue, venues);
                const venueCourts = courts.filter((c) => c.venue_id === venue.id);
                return (
                  <div key={venue.id} className="settings-venue" style={{ borderLeftColor: color }}>
                    <form action={updateVenueBasics} className="settings-venue-row">
                      <input type="hidden" name="id" value={venue.id} />
                      <input type="hidden" name="return_to" value="/settings" />
                      <input
                        className="input settings-color"
                        type="color"
                        name="color"
                        defaultValue={color}
                        aria-label={`${venue.name} colour`}
                      />
                      <input className="input" name="name" defaultValue={venue.name} required aria-label="Venue name" />
                      <SubmitButton size="small">Save</SubmitButton>
                    </form>
                    {venueCourts.length ? (
                      <details className="disclosure">
                        <summary className="small muted settings-courts-toggle">
                          {venueCourts.length} court{venueCourts.length === 1 ? "" : "s"} · edit names
                        </summary>
                        <div className="stack tight" style={{ marginTop: 8 }}>
                          {venueCourts.map((court) => (
                            <form key={court.id} action={updateCourt} className="settings-court-row">
                              <input type="hidden" name="id" value={court.id} />
                              <input type="hidden" name="return_to" value="/settings" />
                              <input type="hidden" name="surface" value={court.surface ?? ""} />
                              <input className="input" name="name" defaultValue={court.name} required maxLength={60} aria-label="Court name" />
                              <input
                                className="input"
                                name="alt_name"
                                defaultValue={court.alt_name ?? ""}
                                placeholder="Name on office sheet"
                                maxLength={60}
                                aria-label="Name on the office sheet"
                              />
                              <SubmitButton size="small">Save</SubmitButton>
                            </form>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Session types">
            <div className="list">
              {types.map((type) => (
                <form key={type.id} action={updateSessionType} className="list-item" style={{ padding: "10px 16px" }}>
                  <input type="hidden" name="id" value={type.id} />
                  <div className="grow" style={{ fontWeight: 600, opacity: type.is_active ? 1 : 0.5 }}>
                    {type.name}
                  </div>
                  <input
                    className="input"
                    type="number"
                    name="duration_minutes"
                    defaultValue={type.duration_minutes}
                    min={15}
                    max={480}
                    style={{ width: 76, height: 32 }}
                    aria-label="Minutes"
                  />
                  <label className="check small" title="Active">
                    <input type="checkbox" name="is_active" defaultChecked={type.is_active} />
                  </label>
                  <SubmitButton size="small">Save</SubmitButton>
                </form>
              ))}
            </div>
            <form action={addSessionType} className="card-body row wrap" style={{ borderTop: "1px solid var(--line)" }}>
              <input className="input" name="name" placeholder="e.g. Cardio tennis" style={{ flex: 1, minWidth: 140 }} required />
              <input className="input" type="number" name="duration_minutes" defaultValue={60} min={15} max={480} style={{ width: 80 }} aria-label="Minutes" />
              <SubmitButton size="small" icon="plus">Add</SubmitButton>
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
