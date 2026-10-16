import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isStaff } from "@/lib/session";
import { loadReferenceData } from "@/lib/data";
import { filtersToQuery, parseFilters, queryAppointments, VIEWS } from "@/lib/appointment-query";
import { formatDate, formatTimeRange, relativeTime, ALL_STATUSES, STATUS_META } from "@/lib/format";
import type { AppointmentWithRelations } from "@/lib/types";
import { ButtonLink, CoachDot, EmptyState, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { ColumnToggle, SelectAll, SelectedCount } from "@/components/table-tools";
import { bulkAction, deleteView, saveView } from "./actions";

export const metadata: Metadata = { title: "Appointments" };

const COLUMNS = [
  { key: "when", label: "When" },
  { key: "student", label: "Student" },
  { key: "coach", label: "Coach" },
  { key: "venue", label: "Venue" },
  { key: "status", label: "Status" },
  { key: "agent", label: "Handled by" },
  { key: "contacted", label: "Contacted" }
];

export default async function AppointmentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership, user } = await requireSession();
  const staff = isStaff(membership.role);
  const filters = parseFilters(params);
  const tz = org.timezone;

  const [ref, result, viewsRes] = await Promise.all([
    loadReferenceData(supabase, org.id),
    queryAppointments(supabase, org.id, tz, filters),
    supabase.from("saved_views").select("id, name, query").eq("org_id", org.id).eq("user_id", user.id).order("created_at")
  ]);

  const rows = (result.data ?? []) as unknown as AppointmentWithRelations[];
  const total = result.count ?? rows.length;
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentQuery = filtersToQuery(filters);
  const savedViews = (viewsRes.data ?? []) as { id: string; name: string; query: string }[];
  const hasFilters = Boolean(filters.q || filters.coach || filters.venue || filters.status || filters.from || filters.to);

  return (
    <>
      <Flash params={params} />
      <PageHeader
        title="Appointments"
        subtitle={`${total} ${total === 1 ? "appointment" : "appointments"} in this view`}
        actions={
          <>
            <a className="btn" href={`/api/appointments/export?${currentQuery}`}>
              <Icon name="download" size={16} /> Export CSV
            </a>
            {staff ? (
              <ButtonLink href="/appointments/new" variant="primary" icon="plus">
                New appointment
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <nav className="tabs" aria-label="Views">
        {VIEWS.map((view) => (
          <Link
            key={view.key}
            href={`/appointments?${filtersToQuery({ ...filters, view: view.key, page: 1, status: "" , sort: undefined })}`}
            className={`tab ${filters.view === view.key ? "active" : ""}`}
          >
            {view.label}
          </Link>
        ))}
      </nav>

      {savedViews.length > 0 ? (
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <span className="small muted row" style={{ gap: 4 }}>
            <Icon name="bookmark" size={14} /> Saved:
          </span>
          {savedViews.map((view) => (
            <span key={view.id} className="row" style={{ gap: 2 }}>
              <Link href={`/appointments?${view.query}`} className={`badge plain ${view.query === currentQuery ? "tone-green" : "tone-slate"}`}>
                {view.name}
              </Link>
              <form action={deleteView}>
                <input type="hidden" name="id" value={view.id} />
                <button className="btn ghost small" style={{ height: 22, padding: "0 4px" }} title="Remove saved view" type="submit">
                  <Icon name="x" size={12} />
                </button>
              </form>
            </span>
          ))}
        </div>
      ) : null}

      <section className="card">
        <form className="toolbar" method="get" action="/appointments">
          <input type="hidden" name="view" value={filters.view} />
          <label className="field search">
            <span>Search</span>
            <input className="input" name="q" defaultValue={filters.q} placeholder="Student, phone, email or reference" />
          </label>
          <label className="field">
            <span>Coach</span>
            <select className="input" name="coach" defaultValue={filters.coach}>
              <option value="">All coaches</option>
              {ref.coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Venue</span>
            <select className="input" name="venue" defaultValue={filters.venue}>
              <option value="">All venues</option>
              {ref.venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select className="input" name="status" defaultValue={filters.status}>
              <option value="">Any</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ minWidth: 130 }}>
            <span>From</span>
            <input className="input" type="date" name="from" defaultValue={filters.from} />
          </label>
          <label className="field" style={{ minWidth: 130 }}>
            <span>To</span>
            <input className="input" type="date" name="to" defaultValue={filters.to} />
          </label>
          <label className="field" style={{ minWidth: 120 }}>
            <span>Order</span>
            <select className="input" name="sort" defaultValue={filters.sort}>
              <option value="asc">Soonest first</option>
              <option value="desc">Latest first</option>
            </select>
          </label>
          <div className="row">
            <button className="btn primary" type="submit">
              <Icon name="filter" size={15} /> Apply
            </button>
            {hasFilters ? (
              <Link className="btn ghost" href={`/appointments?${filtersToQuery({ view: filters.view })}`}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <div className="row between wrap" style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
          {staff ? <SelectedCount formId="bulk-form" /> : <span />}
          <div className="row">
            <details className="disclosure picker">
              <summary className="btn small">
                <Icon name="bookmark" size={15} /> Save view
              </summary>
              <form action={saveView} className="picker-menu card-pad stack tight" style={{ left: "auto", right: 0, width: 260 }}>
                <input type="hidden" name="query" value={currentQuery} />
                <label className="field">
                  <span>Name this view</span>
                  <input className="input" name="name" required maxLength={60} placeholder="e.g. Miguel this week" />
                </label>
                <SubmitButton size="small" variant="primary">Save</SubmitButton>
              </form>
            </details>
            <ColumnToggle columns={COLUMNS} />
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={hasFilters ? "No appointments match these filters" : "Nothing here yet"}
            body={
              hasFilters
                ? "Try clearing a filter or switching to the All tab."
                : staff
                  ? "Book your first session and it will appear here, ready to send by WhatsApp."
                  : "Sessions assigned to you will appear here."
            }
            action={staff && !hasFilters ? <ButtonLink href="/appointments/new" variant="primary" icon="plus">New appointment</ButtonLink> : null}
          />
        ) : (
          <form id="bulk-form" action={bulkAction}>
            <input type="hidden" name="return_to" value={`/appointments?${currentQuery}`} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {staff ? (
                      <th className="check-col">
                        <SelectAll formId="bulk-form" />
                      </th>
                    ) : null}
                    <th data-col="when">
                      <Link href={`/appointments?${filtersToQuery(filters, { sort: filters.sort === "asc" ? "desc" : "asc", page: 1 })}`}>
                        When <Icon name={filters.sort === "asc" ? "chevronRight" : "chevronLeft"} size={12} style={{ transform: "rotate(90deg)" }} />
                      </Link>
                    </th>
                    <th data-col="student">Student</th>
                    <th data-col="coach">Coach</th>
                    <th data-col="venue">Venue</th>
                    <th data-col="status">Status</th>
                    <th data-col="agent">Handled by</th>
                    <th data-col="contacted">Contacted</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      {staff ? (
                        <td className="check-col">
                          <input type="checkbox" name="ids" value={a.id} aria-label={`Select ${a.student?.full_name}`} />
                        </td>
                      ) : null}
                      <td data-col="when" className="nowrap">
                        <div className="cell-main">{formatDate(a.starts_at, tz, "short")}</div>
                        <div className="cell-sub mono">{formatTimeRange(a.starts_at, a.ends_at, tz)}</div>
                      </td>
                      <td data-col="student">
                        <Link href={`/appointments/${a.id}`} className="cell-main">
                          {a.student?.full_name}
                        </Link>
                        <div className="cell-sub">
                          {a.reference}
                          {a.session_type ? ` · ${a.session_type.name}` : ""}
                        </div>
                      </td>
                      <td data-col="coach" className="nowrap">
                        <span className="row" style={{ gap: 8 }}>
                          <CoachDot color={a.coach?.color} />
                          {a.coach?.full_name}
                        </span>
                      </td>
                      <td data-col="venue">
                        <div>{a.venue?.name}</div>
                        {a.court ? <div className="cell-sub">{a.court.name}</div> : null}
                      </td>
                      <td data-col="status">
                        <StatusBadge status={a.status} />
                      </td>
                      <td data-col="agent" className="cell-sub">
                        {a.agent?.full_name || a.agent?.email || "—"}
                      </td>
                      <td data-col="contacted" className="cell-sub nowrap">
                        {a.contacted_at ? relativeTime(a.contacted_at) : "—"}
                      </td>
                      <td>
                        <Link href={`/appointments/${a.id}`} className="btn small ghost" aria-label="Open appointment">
                          <Icon name="chevronRight" size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {staff ? (
              <div className="row wrap" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
                <select className="input" name="bulk_action" defaultValue="" style={{ width: "auto" }} aria-label="Bulk action">
                  <option value="">With selected…</option>
                  <option value="confirm">Student confirmed</option>
                  <option value="office_approved">Office approved</option>
                  <option value="complete">Mark completed</option>
                  <option value="no_show">Mark no-show</option>
                  <option value="cancel">Cancel</option>
                </select>
                <SubmitButton size="small" confirmText="Apply this change to all selected appointments?">
                  Apply to selected
                </SubmitButton>
              </div>
            ) : null}
          </form>
        )}

        {pages > 1 ? (
          <div className="row between" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
            <span className="small muted">
              Page {filters.page} of {pages}
            </span>
            <div className="row">
              {filters.page > 1 ? (
                <Link className="btn small" href={`/appointments?${filtersToQuery(filters, { page: filters.page - 1 })}`}>
                  <Icon name="chevronLeft" size={15} /> Previous
                </Link>
              ) : null}
              {filters.page < pages ? (
                <Link className="btn small" href={`/appointments?${filtersToQuery(filters, { page: filters.page + 1 })}`}>
                  Next <Icon name="chevronRight" size={15} />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
