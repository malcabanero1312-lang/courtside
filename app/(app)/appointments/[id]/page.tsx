import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, isStaff } from "@/lib/session";
import { APPOINTMENT_SELECT, type AppointmentWithRelations, type MessageTemplate, type SessionType } from "@/lib/types";
import { durationLabel, formatDate, formatDateTime, formatTimeRange, minutesBetween, relativeTime, STATUS_META } from "@/lib/format";
import { ensureResponseLink, responseUrl } from "@/lib/links";
import { buildTemplateVars, renderTemplate } from "@/lib/templates";
import { describeEvent, type AppointmentEvent } from "@/lib/events";
import { Card, CoachDot, Flash, PageHeader, StatusBadge, one } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { WhatsAppPanel } from "@/components/whatsapp-panel";
import { ResponseLinkBox } from "@/components/response-link-box";
import { changeStatus, recordOfficeDecision, regenerateLink, updateAppointmentDetails } from "../actions";

export const metadata: Metadata = { title: "Appointment" };

function StatusForm({
  id,
  version,
  status,
  label,
  variant,
  icon,
  confirmText,
  withReason
}: {
  id: string;
  version: number;
  status: string;
  label: string;
  variant?: "primary" | "danger" | "ghost";
  icon?: Parameters<typeof SubmitButton>[0]["icon"];
  confirmText?: string;
  withReason?: boolean;
}) {
  return (
    <form action={changeStatus} className={withReason ? "stack tight" : undefined}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="status" value={status} />
      {withReason ? (
        <input className="input" name="reason" placeholder="Reason (optional, shared with the student)" maxLength={300} />
      ) : null}
      <SubmitButton variant={variant} icon={icon} confirmText={confirmText} block={withReason}>
        {label}
      </SubmitButton>
    </form>
  );
}

export default async function AppointmentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org, membership, user } = await requireSession();
  const staff = isStaff(membership.role);
  const tz = org.timezone;

  const { data } = await supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  const appt = data as unknown as AppointmentWithRelations;

  const [eventsRes, notificationsRes, templatesRes, coachesRes, typesRes, agentsRes, nextRes] = await Promise.all([
    supabase.from("appointment_events").select("*").eq("appointment_id", id).order("created_at", { ascending: false }).limit(100),
    staff
      ? supabase
          .from("notifications")
          .select("id, template_key, recipient_type, recipient_email, status, last_error, sent_at, created_at")
          .eq("appointment_id", id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("message_templates").select("*").eq("org_id", org.id).eq("channel", "whatsapp").order("name"),
    supabase.from("coaches").select("id, full_name").eq("org_id", org.id),
    staff ? supabase.from("session_types").select("*").eq("org_id", org.id).order("name") : Promise.resolve({ data: [] as never[] }),
    staff
      ? supabase.from("memberships").select("id, full_name, email").eq("org_id", org.id).in("role", ["admin", "agent"])
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("appointments").select("id, reference").eq("rescheduled_from_id", id).maybeSingle()
  ]);

  const events = (eventsRes.data ?? []) as AppointmentEvent[];
  const notifications = (notificationsRes.data ?? []) as {
    id: string;
    template_key: string;
    recipient_type: string;
    recipient_email: string | null;
    status: string;
    last_error: string | null;
    sent_at: string | null;
    created_at: string;
  }[];
  const templates = (templatesRes.data ?? []) as MessageTemplate[];
  const coachNames = Object.fromEntries(((coachesRes.data ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
  const sessionTypes = (typesRes.data ?? []) as SessionType[];
  const agents = (agentsRes.data ?? []) as { id: string; full_name: string; email: string }[];
  const replacement = nextRes.data as { id: string; reference: string } | null;

  const isOpen = ["scheduled", "awaiting_response", "pending_approval", "confirmed", "not_approved", "reschedule_requested", "declined"].includes(
    appt.status
  );
  const isPast = new Date(appt.ends_at).getTime() < Date.now();
  const isOwnCoach = Boolean(appt.coach?.user_id && appt.coach.user_id === user.id);
  const canAct = staff || isOwnCoach;
  const isResult = appt.status === "confirmed" || appt.status === "not_approved";
  const waitingForOffice = appt.status === "pending_approval";
  const canMessageStudent = !isPast && ((staff && isOpen && !waitingForOffice) || (isOwnCoach && isResult));
  const canMessageOffice = canAct && waitingForOffice && !isPast;

  let token: string | null = null;
  if (staff && canMessageStudent && appt.status !== "not_approved") {
    token = await ensureResponseLink(supabase, {
      orgId: org.id,
      appointmentId: appt.id,
      startsAt: appt.starts_at,
      linkDays: org.response_link_days,
      userId: user.id
    });
  }
  const link = token ? responseUrl(token) : null;

  const vars = buildTemplateVars({
    appointment: appt,
    org,
    responseLink: link,
    agentName: membership.full_name || null
  });
  const rendered = templates.map((t) => ({ key: t.key, name: t.name, text: renderTemplate(t.body, vars) }));
  const officeMessages = rendered.filter((m) => m.key === "office_request");
  const resultKeys = ["office_approved", "office_not_approved"];
  const messages = rendered.filter((m) => {
    if (m.key === "office_request") return false;
    if (isOwnCoach && !staff) return resultKeys.includes(m.key) || m.key === "reminder";
    return true;
  });
  const needsResultMessage = isResult && !appt.student_informed_at;
  const defaultKey =
    appt.status === "not_approved"
      ? "office_not_approved"
      : appt.status === "confirmed"
        ? needsResultMessage
          ? "office_approved"
          : "reminder"
        : appt.rescheduled_from_id && appt.status === "scheduled"
          ? "rescheduled"
          : appt.status === "awaiting_response"
            ? "follow_up"
            : "appointment_request";
  const resolvedDefault = messages.some((m) => m.key === defaultKey) ? defaultKey : messages[0]?.key ?? "";

  const minutes = minutesBetween(appt.starts_at, appt.ends_at);
  const meta = STATUS_META[appt.status];

  return (
    <>
      <div className="row small" style={{ marginBottom: 10 }}>
        <Link href="/appointments" className="muted row" style={{ gap: 4 }}>
          <Icon name="chevronLeft" size={15} /> Appointments
        </Link>
      </div>
      <Flash params={sp} />
      <PageHeader
        eyebrow={appt.reference}
        title={appt.student?.full_name ?? "Appointment"}
        subtitle={meta.hint}
        actions={
          <>
            <StatusBadge status={appt.status} />
            <a className="btn small" href={`/api/appointments/${appt.id}/calendar`}>
              <Icon name="download" size={15} /> Calendar
            </a>
            {staff && isOpen ? (
              <Link className="btn small" href={`/appointments/${appt.id}/reschedule`}>
                <Icon name="refresh" size={15} /> Reschedule
              </Link>
            ) : null}
          </>
        }
      />

      {replacement ? (
        <div className="notice info">
          <Icon name="arrowRight" size={17} />
          <div>
            This session was moved. The new appointment is{" "}
            <Link className="link" href={`/appointments/${replacement.id}`}>
              {replacement.reference}
            </Link>
            .
          </div>
        </div>
      ) : null}

      {appt.status === "reschedule_requested" ? (
        <div className="notice warn">
          <Icon name="refresh" size={17} />
          <div className="grow">
            <strong>The student asked for another time.</strong>
            {appt.student_note ? <div style={{ marginTop: 4 }}>“{appt.student_note}”</div> : null}
            {staff ? (
              <div style={{ marginTop: 10 }}>
                <Link className="btn small primary" href={`/appointments/${appt.id}/reschedule`}>
                  Pick a new time
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {waitingForOffice ? (
        <div className="notice info">
          <Icon name="clock" size={17} />
          <div>
            <strong>The student confirmed. Now the office needs to approve.</strong>{" "}
            {appt.office_contacted_at
              ? `Sent to the office ${relativeTime(appt.office_contacted_at)} — waiting for their answer.`
              : "Send the booking to the office using the message below."}
            {appt.student_note ? <div style={{ marginTop: 4 }}>Student's note: “{appt.student_note}”</div> : null}
          </div>
        </div>
      ) : null}

      {appt.status === "not_approved" ? (
        <div className="notice error">
          <Icon name="x" size={17} />
          <div>
            <strong>The office didn't approve this booking.</strong> {appt.office_note ? `Office note: “${appt.office_note}”.` : ""} The time
            slot is free again.{" "}
            {appt.student_informed_at ? "The student has been told." : "Let the student know using the message below."}
          </div>
        </div>
      ) : null}

      {appt.status === "confirmed" && appt.office_note ? (
        <div className="notice success">
          <Icon name="checkCircle" size={17} />
          <div>
            <strong>Approved by the office.</strong> Office note: “{appt.office_note}”
          </div>
        </div>
      ) : null}

      {appt.status === "declined" ? (
        <div className="notice error">
          <Icon name="x" size={17} />
          <div>
            <strong>The student declined.</strong> {appt.student_note ? `“${appt.student_note}”` : "No reason given."} The time slot is free
            again.
          </div>
        </div>
      ) : null}

      <div className="grid main-side">
        <div className="stack">
          <section className="card">
            <div className="hero-appt">
              <div>
                <div className="when-big">{formatDate(appt.starts_at, tz)}</div>
                <div className="muted" style={{ fontSize: 16, marginTop: 2 }}>
                  {formatTimeRange(appt.starts_at, appt.ends_at, tz)} · {durationLabel(minutes)}
                </div>
              </div>
              <div className="small muted" style={{ textAlign: "right" }}>
                {isPast ? "Took place" : "Starts"} {relativeTime(appt.starts_at)}
              </div>
            </div>
            <div className="facts">
              <div className="fact">
                <Icon name="whistle" />
                <div>
                  <div className="fact-label">Coach</div>
                  <div className="fact-value row">
                    <CoachDot color={appt.coach?.color} /> {appt.coach?.full_name}
                  </div>
                </div>
              </div>
              <div className="fact">
                <Icon name="pin" />
                <div>
                  <div className="fact-label">Venue</div>
                  <div className="fact-value">
                    {appt.venue?.name}
                    {appt.court ? ` · ${appt.court.name}` : ""}
                  </div>
                  {appt.venue?.address ? <div className="small muted">{appt.venue.address}</div> : null}
                </div>
              </div>
              <div className="fact">
                <Icon name="user" />
                <div>
                  <div className="fact-label">Student</div>
                  <div className="fact-value">
                    {staff ? (
                      <Link className="link" href={`/students/${appt.student_id}`}>
                        {appt.student?.full_name}
                      </Link>
                    ) : (
                      appt.student?.full_name
                    )}
                  </div>
                  <div className="small muted">
                    {[appt.student?.phone ? `+${appt.student.phone}` : null, appt.student?.email].filter(Boolean).join(" · ")}
                  </div>
                  {appt.student?.guardian_name ? <div className="small muted">Guardian: {appt.student.guardian_name}</div> : null}
                </div>
              </div>
              <div className="fact">
                <Icon name="ball" />
                <div>
                  <div className="fact-label">Session</div>
                  <div className="fact-value">{appt.session_type?.name ?? "Not specified"}</div>
                  <div className="small muted">Handled by {appt.agent?.full_name || appt.agent?.email || "—"}</div>
                </div>
              </div>
            </div>
            {appt.notes ? (
              <div className="card-body">
                <div className="fact-label" style={{ marginBottom: 4 }}>
                  Notes
                </div>
                <p style={{ whiteSpace: "pre-wrap" }}>{appt.notes}</p>
              </div>
            ) : null}
          </section>

          {canMessageOffice ? (
            <>
              {officeMessages.length > 0 ? (
                <WhatsAppPanel
                  appointmentId={appt.id}
                  phone={org.office_phone}
                  messages={officeMessages}
                  defaultKey="office_request"
                  highlight={!appt.office_contacted_at}
                  studentName={appt.student?.full_name ?? "the student"}
                  target="office"
                  title={org.office_name ? `Ask ${org.office_name} to approve` : "Ask the office to approve"}
                  doneText="Recorded. When the office answers, save their decision below."
                />
              ) : (
                <div className="notice warn">
                  <Icon name="alert" size={17} />
                  <div>The message to the office is missing. An admin can add it under Settings → Message templates → Restore missing defaults.</div>
                </div>
              )}
              <Card title="What did the office decide?" padded>
                <form action={recordOfficeDecision} className="stack">
                  <input type="hidden" name="id" value={appt.id} />
                  <input type="hidden" name="version" value={appt.version} />
                  <label className="field">
                    <span>Note from the office (optional)</span>
                    <input
                      className="input"
                      name="office_note"
                      maxLength={300}
                      placeholder="e.g. Approved, Court 2 reserved — or the reason it can't go ahead"
                    />
                    <small>If the office doesn't approve, this note is included in the message to the student.</small>
                  </label>
                  <div className="row wrap">
                    <SubmitButton variant="primary" icon="check" name="decision" value="approved">
                      Office approved
                    </SubmitButton>
                    <SubmitButton
                      variant="danger"
                      icon="x"
                      name="decision"
                      value="not_approved"
                      confirmText="Record that the office did NOT approve? The time slot will be freed."
                    >
                      Office didn't approve
                    </SubmitButton>
                  </div>
                </form>
              </Card>
            </>
          ) : null}

          {canMessageStudent && messages.length > 0 ? (
            <WhatsAppPanel
              appointmentId={appt.id}
              phone={appt.student?.phone ?? null}
              messages={messages}
              defaultKey={resolvedDefault}
              highlight={one(sp.send) === "1" || needsResultMessage}
              studentName={appt.student?.full_name ?? "the student"}
              title={
                needsResultMessage
                  ? `Tell ${appt.student?.full_name?.split(" ")[0] ?? "the student"} the office's answer`
                  : undefined
              }
              doneText={needsResultMessage ? "Recorded. The student has been told the office's answer." : undefined}
            />
          ) : null}

          <Card title="History">
            {events.length === 0 ? (
              <div className="card-body muted">No activity yet.</div>
            ) : (
              <ul className="timeline">
                {events.map((event) => {
                  const described = describeEvent(event, tz, coachNames);
                  return (
                    <li key={event.id}>
                      <span className={`timeline-dot ${event.actor_type}`} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{described.title}</div>
                        {described.detail ? <div className="small" style={{ color: "var(--ink-2)" }}>{described.detail}</div> : null}
                        <div className="small faint">{formatDateTime(event.created_at, tz)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <aside className="stack">
          <Card title="Actions" padded>
            <div className="stack tight">
              {staff && ["scheduled", "awaiting_response", "reschedule_requested", "declined"].includes(appt.status) && !isPast ? (
                <StatusForm
                  id={appt.id}
                  version={appt.version}
                  status="pending_approval"
                  label="Student confirmed (by phone/chat)"
                  variant="primary"
                  icon="check"
                />
              ) : null}
              {staff && appt.status === "scheduled" ? (
                <StatusForm id={appt.id} version={appt.version} status="awaiting_response" label="Mark as contacted" icon="send" />
              ) : null}
              {isPast && ["scheduled", "awaiting_response", "pending_approval", "confirmed"].includes(appt.status) ? (
                <>
                  <StatusForm id={appt.id} version={appt.version} status="completed" label="Mark completed" variant="primary" icon="check" />
                  <StatusForm id={appt.id} version={appt.version} status="no_show" label="Mark no-show" icon="ban" />
                </>
              ) : null}
              {appt.status === "completed" ? (
                <StatusForm id={appt.id} version={appt.version} status="no_show" label="Change to no-show" icon="ban" />
              ) : null}
              {appt.status === "no_show" ? (
                <StatusForm id={appt.id} version={appt.version} status="completed" label="Change to completed" icon="check" />
              ) : null}
              {staff && appt.status === "cancelled" ? (
                <StatusForm
                  id={appt.id}
                  version={appt.version}
                  status="scheduled"
                  label="Restore appointment"
                  icon="undo"
                  confirmText="Restore this appointment? We'll check the time is still free."
                />
              ) : null}
              {staff && isOpen && !isPast ? (
                <details className="disclosure">
                  <summary className="btn danger block">
                    <Icon name="x" size={16} /> Cancel appointment…
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    <StatusForm
                      id={appt.id}
                      version={appt.version}
                      status="cancelled"
                      label="Confirm cancellation"
                      variant="danger"
                      withReason
                      confirmText="Cancel this appointment? The student will be emailed if they have an email address."
                    />
                  </div>
                </details>
              ) : null}
              {!staff && !isPast ? (
                <p className="small muted">Coaches can record the office's decision, message the student the result, and mark attendance after the session.</p>
              ) : null}
            </div>
          </Card>

          {staff && link ? (
            <Card title="Student response link" padded>
              <ResponseLinkBox appointmentId={appt.id} link={link} />
              <form action={regenerateLink} style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={appt.id} />
                <SubmitButton
                  size="small"
                  variant="ghost"
                  icon="refresh"
                  confirmText="Create a new link? The current link will stop working."
                >
                  Replace link
                </SubmitButton>
              </form>
            </Card>
          ) : null}

          <Card title="Details" padded>
            <form action={updateAppointmentDetails} className="stack">
              <input type="hidden" name="id" value={appt.id} />
              {staff ? (
                <>
                  <label className="field">
                    <span>Session type</span>
                    <select className="input" name="session_type_id" defaultValue={appt.session_type_id ?? ""}>
                      <option value="">Not specified</option>
                      {sessionTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Handled by</span>
                    <select className="input" name="agent_id" defaultValue={appt.assigned_agent_id ?? ""}>
                      <option value="">Nobody</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name || a.email}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <label className="field">
                <span>Notes</span>
                <textarea className="input" name="notes" defaultValue={appt.notes ?? ""} maxLength={1000} />
              </label>
              <SubmitButton size="small">Save details</SubmitButton>
            </form>
          </Card>

          {staff ? (
            <Card
              title="Email updates"
              actions={
                <Link href="/notifications" className="small link">
                  All emails
                </Link>
              }
            >
              {notifications.length === 0 ? (
                <div className="card-body small muted">No emails for this appointment yet.</div>
              ) : (
                <div className="list">
                  {notifications.map((n) => (
                    <div key={n.id} className="list-item" style={{ padding: "10px 16px" }}>
                      <div className="grow">
                        <div className="small" style={{ fontWeight: 600 }}>
                          To {n.recipient_type}
                          {n.recipient_email ? ` · ${n.recipient_email}` : ""}
                        </div>
                        <div className="small muted">{n.template_key.replace(/_/g, " ")}</div>
                        {n.last_error && n.status !== "sent" ? <div className="small" style={{ color: "var(--clay)" }}>{n.last_error}</div> : null}
                      </div>
                      <span
                        className={`badge plain ${
                          n.status === "sent" ? "tone-green" : n.status === "skipped" ? "tone-muted" : n.status === "pending" || n.status === "sending" ? "tone-slate" : "tone-red"
                        }`}
                      >
                        {n.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
