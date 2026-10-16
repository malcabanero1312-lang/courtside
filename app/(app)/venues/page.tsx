import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import type { Court, Venue } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { addDays, todayInZone } from "@/lib/time";
import { Card, EmptyState, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { addClosure, addCourt, createVenue, toggleCourt, updateVenue } from "./actions";
import { deleteBlockedTime } from "../coaches/actions";

export const metadata: Metadata = { title: "Venues & courts" };

function VenueFields({ venue }: { venue?: Venue }) {
  return (
    <div className="form-grid">
      <label className="field span-2">
        <span>Venue name</span>
        <input className="input" name="name" defaultValue={venue?.name ?? ""} required placeholder="Makati Sports Club" />
      </label>
      <label className="field span-2">
        <span>Address</span>
        <input className="input" name="address" defaultValue={venue?.address ?? ""} placeholder="Shown to students with a Directions button" />
      </label>
      <label className="field">
        <span>Opens</span>
        <input className="input" type="time" name="opens_at" defaultValue={venue?.opens_at?.slice(0, 5) ?? "06:00"} />
      </label>
      <label className="field">
        <span>Closes</span>
        <input className="input" type="time" name="closes_at" defaultValue={venue?.closes_at?.slice(0, 5) ?? "22:00"} />
      </label>
      <label className="field span-2">
        <span>Google Maps link (optional)</span>
        <input className="input" name="maps_url" defaultValue={venue?.maps_url ?? ""} placeholder="https://maps.app.goo.gl/…" />
      </label>
    </div>
  );
}

export default async function VenuesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership } = await requireSession(["admin", "agent"]);
  const isAdmin = membership.role === "admin";
  const tz = org.timezone;
  const [venuesRes, courtsRes, blockedRes] = await Promise.all([
    supabase.from("venues").select("*").eq("org_id", org.id).order("name"),
    supabase.from("courts").select("*").eq("org_id", org.id).order("name"),
    supabase
      .from("blocked_times")
      .select("*")
      .eq("org_id", org.id)
      .is("coach_id", null)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
  ]);
  const venues = (venuesRes.data ?? []) as Venue[];
  const courts = (courtsRes.data ?? []) as Court[];
  const blocked = (blockedRes.data ?? []) as { id: string; venue_id: string | null; court_id: string | null; starts_at: string; ends_at: string; reason: string | null }[];
  const courtName = new Map(courts.map((c) => [c.id, c]));
  const today = todayInZone(tz);

  return (
    <>
      <Flash params={params} />
      <PageHeader title="Venues & courts" subtitle="Opening hours and closures are checked whenever a session is booked." />
      <div className="grid main-side">
        <div className="stack">
          {venues.length === 0 ? (
            <Card>
              <EmptyState icon="court" title="No venues yet" body="Add the club or courts where you coach. You can add as many as you need." />
            </Card>
          ) : null}
          {venues.map((venue) => {
            const venueCourts = courts.filter((c) => c.venue_id === venue.id);
            const closures = blocked.filter((b) => b.venue_id === venue.id || (b.court_id && courtName.get(b.court_id)?.venue_id === venue.id));
            return (
              <Card
                key={venue.id}
                title={
                  <span className="row">
                    {venue.name}
                    {!venue.is_active ? <span className="badge plain tone-muted">Inactive</span> : null}
                  </span>
                }
                actions={<span className="small muted">{venue.opens_at.slice(0, 5)}–{venue.closes_at.slice(0, 5)}</span>}
              >
                <div className="card-body stack">
                  {venue.address ? <p className="small muted">{venue.address}</p> : null}
                  <div className="row wrap">
                    {venueCourts.length === 0 ? <span className="small muted">No courts added — sessions can still be booked at this venue.</span> : null}
                    {venueCourts.map((court) => (
                      <form key={court.id} action={toggleCourt} className="row" style={{ gap: 4 }}>
                        <input type="hidden" name="id" value={court.id} />
                        <input type="hidden" name="active" value={court.is_active ? "0" : "1"} />
                        <span className={`badge plain ${court.is_active ? "tone-green" : "tone-muted"}`}>
                          {court.name}
                          {court.surface ? ` · ${court.surface}` : ""}
                        </span>
                        {isAdmin ? (
                          <SubmitButton size="small" variant="ghost">
                            {court.is_active ? "Close" : "Reopen"}
                          </SubmitButton>
                        ) : null}
                      </form>
                    ))}
                  </div>
                  {isAdmin ? (
                    <form action={addCourt} className="row wrap">
                      <input type="hidden" name="venue_id" value={venue.id} />
                      <input className="input" name="name" placeholder={`Court ${venueCourts.length + 1}`} style={{ width: 150 }} required />
                      <select className="input" name="surface" style={{ width: 140 }} defaultValue="">
                        <option value="">Surface…</option>
                        <option>Hard</option>
                        <option>Clay</option>
                        <option>Grass</option>
                        <option>Artificial grass</option>
                        <option>Indoor</option>
                      </select>
                      <SubmitButton size="small" icon="plus">Add court</SubmitButton>
                    </form>
                  ) : null}
                  {closures.length > 0 ? (
                    <div className="stack tight">
                      <span className="label">Upcoming closures</span>
                      {closures.map((b) => (
                        <div key={b.id} className="row between small">
                          <span>
                            <strong>{b.court_id ? courtName.get(b.court_id)?.name : "Whole venue"}</strong> · {formatDateTime(b.starts_at, tz)} →{" "}
                            {formatDateTime(b.ends_at, tz)}
                            {b.reason ? <span className="muted"> · {b.reason}</span> : null}
                          </span>
                          <form action={deleteBlockedTime}>
                            <input type="hidden" name="id" value={b.id} />
                            <input type="hidden" name="return_to" value="/venues" />
                            <SubmitButton size="small" variant="ghost" confirmText="Remove this closure?">
                              Remove
                            </SubmitButton>
                          </form>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {isAdmin ? (
                    <details className="disclosure">
                      <summary className="btn small ghost">Edit venue details</summary>
                      <form action={updateVenue} className="stack" style={{ marginTop: 12 }}>
                        <input type="hidden" name="id" value={venue.id} />
                        <VenueFields venue={venue} />
                        <label className="check small">
                          <input type="checkbox" name="is_active" defaultChecked={venue.is_active} /> Active (can be booked)
                        </label>
                        <SubmitButton size="small" variant="primary">Save venue</SubmitButton>
                      </form>
                    </details>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>

        <aside className="stack">
          {isAdmin ? (
            <Card title="Add a venue" padded>
              <form action={createVenue} className="stack">
                <VenueFields />
                <label className="field">
                  <span>Number of courts</span>
                  <input className="input" type="number" name="court_count" min={0} max={30} defaultValue={2} />
                  <small>We'll name them Court 1, Court 2… You can rename later by adding new ones.</small>
                </label>
                <SubmitButton variant="primary" icon="plus">Add venue</SubmitButton>
              </form>
            </Card>
          ) : null}
          {venues.length > 0 ? (
            <Card title="Close a venue or court" padded>
              <form action={addClosure} className="stack">
                <label className="field">
                  <span>What's closed</span>
                  <select className="input" name="target" required>
                    {venues.map((v) => (
                      <optgroup key={v.id} label={v.name}>
                        <option value={`venue:${v.id}`}>Whole venue</option>
                        {courts
                          .filter((c) => c.venue_id === v.id)
                          .map((c) => (
                            <option key={c.id} value={`court:${c.id}`}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>From date</span>
                    <input className="input" type="date" name="start_date" defaultValue={addDays(today, 1)} required />
                  </label>
                  <label className="field">
                    <span>Until date</span>
                    <input className="input" type="date" name="end_date" defaultValue={addDays(today, 1)} />
                  </label>
                  <label className="field">
                    <span>From time</span>
                    <input className="input" type="time" name="start_time" defaultValue="00:00" />
                  </label>
                  <label className="field">
                    <span>Until time</span>
                    <input className="input" type="time" name="end_time" defaultValue="23:59" />
                  </label>
                </div>
                <input className="input" name="reason" placeholder="Reason, e.g. Resurfacing, tournament" maxLength={200} />
                <SubmitButton icon="ban">Add closure</SubmitButton>
              </form>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
