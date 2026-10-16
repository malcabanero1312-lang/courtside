import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { APPOINTMENT_SELECT, type AppointmentWithRelations, type Student } from "@/lib/types";
import { formatDate, formatTimeRange } from "@/lib/format";
import { ButtonLink, Card, CoachDot, EmptyState, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { StudentFields } from "../student-fields";
import { setStudentArchived, updateStudent } from "../actions";

export const metadata: Metadata = { title: "Student" };

export default async function StudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const { data } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const student = data as Student;

  const { data: apptData } = await supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("student_id", id)
    .order("starts_at", { ascending: false })
    .limit(200);
  const appointments = (apptData ?? []) as unknown as AppointmentWithRelations[];
  const now = Date.now();
  const upcoming = appointments.filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "rescheduled").reverse();
  const past = appointments.filter((a) => new Date(a.starts_at).getTime() < now || a.status === "rescheduled");
  const stats = {
    completed: appointments.filter((a) => a.status === "completed").length,
    noShows: appointments.filter((a) => a.status === "no_show").length,
    cancelled: appointments.filter((a) => a.status === "cancelled" || a.status === "declined").length
  };
  const tz = org.timezone;

  const list = (items: AppointmentWithRelations[]) => (
    <div className="list">
      {items.map((a) => (
        <Link key={a.id} href={`/appointments/${a.id}`} className="list-item">
          <div style={{ width: 130 }} className="nowrap">
            <div style={{ fontWeight: 600 }}>{formatDate(a.starts_at, tz, "short")}</div>
            <div className="small muted mono">{formatTimeRange(a.starts_at, a.ends_at, tz)}</div>
          </div>
          <div className="grow small row truncate" style={{ gap: 6 }}>
            <CoachDot color={a.coach?.color} /> {a.coach?.full_name} · {a.venue?.name}
          </div>
          <StatusBadge status={a.status} />
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <div className="row small" style={{ marginBottom: 10 }}>
        <Link href="/students" className="muted row" style={{ gap: 4 }}>
          <Icon name="chevronLeft" size={15} /> Students
        </Link>
      </div>
      <Flash params={sp} />
      <PageHeader
        title={student.full_name}
        subtitle={
          [student.phone ? `+${student.phone}` : null, student.email, student.is_archived ? "Archived" : null].filter(Boolean).join(" · ") ||
          undefined
        }
        actions={
          !student.is_archived ? (
            <ButtonLink href={`/appointments/new?student=${student.id}`} variant="primary" icon="plus">
              Book a session
            </ButtonLink>
          ) : null
        }
      />

      <div className="kpis">
        <div className="card kpi">
          <span className="kpi-label">Upcoming</span>
          <span className="kpi-value">{upcoming.length}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Completed</span>
          <span className="kpi-value">{stats.completed}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">No-shows</span>
          <span className="kpi-value">{stats.noShows}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Cancelled / declined</span>
          <span className="kpi-value">{stats.cancelled}</span>
        </div>
      </div>

      <div className="grid main-side">
        <div className="stack">
          <Card title="Upcoming sessions">
            {upcoming.length ? list(upcoming) : <EmptyState icon="calendar" title="No upcoming sessions" />}
          </Card>
          <Card title="History">{past.length ? list(past) : <div className="card-body muted small">No past sessions yet.</div>}</Card>
        </div>
        <aside className="stack">
          <Card title="Profile" padded>
            <form action={updateStudent} className="stack">
              <input type="hidden" name="id" value={student.id} />
              <StudentFields student={student} />
              <SubmitButton variant="primary">Save changes</SubmitButton>
            </form>
          </Card>
          <Card padded>
            <form action={setStudentArchived} className="row between wrap">
              <input type="hidden" name="id" value={student.id} />
              <input type="hidden" name="archived" value={student.is_archived ? "0" : "1"} />
              <span className="small muted">
                {student.is_archived ? "This student is hidden from search." : "Archive to hide from search. History is kept."}
              </span>
              <SubmitButton size="small" variant={student.is_archived ? undefined : "danger"}>
                {student.is_archived ? "Restore" : "Archive"}
              </SubmitButton>
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
