import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import type { Court, Venue } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { addDays, todayInZone } from "@/lib/time";
import { Card, EmptyState, Flash, Fold, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { addClosure, addCourt, createVenue, deleteVenue, moveVenueBookings, toggleCourt, updateCourt, updateVenue } from "./actions";
import { deleteBlockedTime } from "../coaches/actions";
import { venueColor } from "@/lib/venue-colors";

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
      <label className="field">
        <span>Colour</span>
        <input className="input" type="color" name="color" defaultValue={venue?.color ?? "#2f7d5b"} style={{ padding: 4, height: 40 }} />
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
  const [venuesRes, courtsRes, blockedRes, usageRes] = await Promise.all([
    supabase.from("venues").select("*").eq("org_id", org.id).order("name"),
    supabase.from("courts").select("*").eq("org_id", org.id).order("name"),
    supabase
      .from("blocked_times")
      .select("*")
      .eq("org_id", org.id)
      .is("coach_id", null)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at"),
    supabase
      .from("appointments")
      .select("venue_id, student_id")
      .eq("org_id", org.id)
      .gte("ends_at", new Date().toISOString())
      .not("status", "in", "(cancelled,declined,not_approved,rescheduled)")
      .limit(10000)
  ]);
  const usage = new Map<string, { bookings: number; students: Set<string> }>();
  for (const row of (usageRes.data ?? []) as { venue_id: string; student_id: string }[]) {
    const u = usage.get(row.venue_id) ?? { bookings: 0, students: new Set<string>() };
    u.bookings += 1;
    u.students.add(row.student_id);
    usage.set(row.venue_id, u);
  }
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
                    <span className="venue-dot" style={{ background: venueColor(venue, venues) }} aria-hidden />
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
                          {court.alt_name ? ` (${court.alt_name})` : ""}
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
                      <input className="input" name="alt_name" placeholder="2nd name (optional)" style={{ width: 170 }} maxLength={60} />
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
                  {isAdmin && venueCourts.length > 0 ? (
                    <details className="disclosure">
                      <summary className="btn small ghost">Rename courts / add 2nd names</summary>
                      <div className="stack tight" style={{ marginTop: 12 }}>
                        <span className="small muted">
                          The 2nd name is what the office sheet calls the court (for example “Hard Courts - 1”). The import matches either name.
                        </span>
                        {venueCourts.map((court) => (
                          <form key={court.id} action={updateCourt} className="row wrap">
                            <input type="hidden" name="id" value={court.id} />
                            <input type="hidden" name="surface" value={court.surface ?? ""} />
                            <input className="input" name="name" defaultValue={court.name} required maxLength={60} style={{ width: 160 }} aria-label="Court name" />
                            <input
                              className="input"
                              name="alt_name"
                              defaultValue={court.alt_name ?? ""}
                              placeholder="2nd name"
                              maxLength={60}
                              style={{ width: 180 }}
                              aria-label="Second name"
                            />
                            <SubmitButton size="small">Save</SubmitButton>
                          </form>
                        ))}
                      </div>
                    </details>
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
                      <summary className="btn small ghost">Edit name & details</summary>
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
                  {isAdmin ? (
                    <details className="disclosure">
                      <summary className="btn small ghost">Move students or delete venue</summary>
                      <div className="stack" style={{ marginTop: 12 }}>
                        <span className="small muted">
                          {usage.get(venue.id)?.bookings ?? 0} upcoming booking{(usage.get(venue.id)?.bookings ?? 0) === 1 ? "" : "s"} for{" "}
                          {usage.get(venue.id)?.students.size ?? 0} student{(usage.get(venue.id)?.students.size ?? 0) === 1 ? "" : "s"} at this venue.
                          Courts with the same name at the new venue are kept; otherwise the court is left empty to choose later.
                        </span>
                        {venues.filter((v) => v.id !== venue.id).length === 0 ? (
                          <span className="small faint">Add another venue first to move students there.</span>
                        ) : (
                          <form action={moveVenueBookings} className="venue-move-row">
                            <input type="hidden" name="from" value={venue.id} />
                            <select className="input" name="to" defaultValue="" required aria-label="Move to venue">
                              <option value="" disabled>
                                Move all students to…
                              </option>
                              {venues
                                .filter((v) => v.id !== venue.id)
                                .map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                            </select>
                            <SubmitButton size="small" confirmText="Move every upcoming booking and weekly schedule at this venue to the chosen venue?">
                              Move
                            </SubmitButton>
                          </form>
                        )}
                        <form action={deleteVenue} className="venue-move-row">
                          <input type="hidden" name="id" value={venue.id} />
                          {venues.filter((v) => v.id !== venue.id).length ? (
                            <select className="input" name="move_to" defaultValue="" aria-label="Move bookings before deleting">
                              <option value="">Delete only if it has no bookings</option>
                              {venues
                                .filter((v) => v.id !== venue.id)
                                .map((v) => (
                                  <option key={v.id} value={v.id}>
                                    Move all bookings to {v.name}, then delete
                                  </option>
                                ))}
                            </select>
                          ) : null}
                          <SubmitButton size="small" variant="danger" confirmText={`Delete ${venue.name}? Its courts and closures are removed. This can't be undone.`}>
                            Delete venue
                          </SubmitButton>
                        </form>
                      </div>
                    </details>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>

        <aside className="stack">
          {isAdmin ? (
            <Fold title="Add a venue" padded open={venues.length === 0}>
              <form action={createVenue} className="stack">
                <VenueFields />
                <label className="field">
                  <span>Number of courts</span>
                  <input className="input" type="number" name="court_count" min={0} max={30} defaultValue={2} />
                  <small>We'll name them Court 1, Court 2… You can rename later by adding new ones.</small>
                </label>
                <SubmitButton variant="primary" icon="plus">Add venue</SubmitButton>
              </form>
            </Fold>
          ) : null}
          {venues.length > 0 ? (
            <Fold title="Close a venue or court" padded>
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
            </Fold>
          ) : null}
        </aside>
      </div>
    </>
  );
}
