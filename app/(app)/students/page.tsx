import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import type { Student } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Card, EmptyState, Flash, Fold, PageHeader, one } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { StudentFields } from "./student-fields";
import { createStudent, importStudents } from "./actions";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const q = one(params.q).trim().slice(0, 60);
  const showArchived = one(params.archived) === "1";
  const page = Math.max(1, Number(one(params.page)) || 1);
  const pageSize = 50;

  let query = supabase
    .from("students")
    .select("*", { count: "exact" })
    .eq("org_id", org.id)
    .eq("is_archived", showArchived)
    .order("full_name")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (q) {
    const safe = q.replace(/[%,()*\\]/g, " ").trim();
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    const filters = [`full_name.ilike.%${safe}%`, `email.ilike.%${safe}%`, `guardian_name.ilike.%${safe}%`];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`);
    query = query.or(filters.join(","));
  }
  const { data, count } = await query;
  const students = (data ?? []) as Student[];
  const total = count ?? students.length;

  const { data: upcoming } = students.length
    ? await supabase
        .from("appointments")
        .select("student_id, starts_at")
        .in("student_id", students.map((s) => s.id))
        .gte("starts_at", new Date().toISOString())
        .in("status", ["scheduled", "awaiting_response", "pending_approval", "confirmed", "reschedule_requested"])
        .order("starts_at")
    : { data: [] };
  const nextByStudent = new Map<string, string>();
  for (const row of (upcoming ?? []) as { student_id: string; starts_at: string }[]) {
    if (!nextByStudent.has(row.student_id)) nextByStudent.set(row.student_id, row.starts_at);
  }

  return (
    <>
      <Flash params={params} />
      <PageHeader
        title="Students"
        subtitle={`${total} ${showArchived ? "archived" : "active"} student${total === 1 ? "" : "s"}`}
        actions={
          <Link className="btn ghost" href={showArchived ? "/students" : "/students?archived=1"}>
            {showArchived ? "Show active" : "Show archived"}
          </Link>
        }
      />

      <div className="grid main-side">
        <Card>
          <form className="toolbar" method="get">
            {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
            <label className="field search">
              <span>Search</span>
              <input className="input" name="q" defaultValue={q} placeholder="Name, phone, email or guardian" />
            </label>
            <button className="btn primary" type="submit">
              <Icon name="search" size={15} /> Search
            </button>
          </form>
          {students.length === 0 ? (
            <EmptyState
              icon="users"
              title={q ? "No students match your search" : "No students yet"}
              body={q ? "Check the spelling or search by phone number." : "Add students here, import a spreadsheet, or create them while booking."}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th className="hide-mobile">Level</th>
                    <th>Next session</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/students/${s.id}`} className="cell-main">
                          {s.full_name}
                        </Link>
                        {s.guardian_name ? <div className="cell-sub">Guardian: {s.guardian_name}</div> : null}
                      </td>
                      <td>
                        <div>{s.phone ? `+${s.phone}` : <span className="faint">No phone</span>}</div>
                        <div className="cell-sub">{s.email ?? ""}</div>
                      </td>
                      <td className="hide-mobile cell-sub">{s.level ?? "—"}</td>
                      <td className="cell-sub nowrap">
                        {nextByStudent.get(s.id) ? formatDate(nextByStudent.get(s.id) as string, org.timezone, "short") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > pageSize ? (
            <div className="row between" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <span className="small muted">
                Page {page} of {Math.ceil(total / pageSize)}
              </span>
              <div className="row">
                {page > 1 ? (
                  <Link className="btn small" href={`/students?${new URLSearchParams({ q, ...(showArchived ? { archived: "1" } : {}), page: String(page - 1) })}`}>
                    Previous
                  </Link>
                ) : null}
                {page * pageSize < total ? (
                  <Link className="btn small" href={`/students?${new URLSearchParams({ q, ...(showArchived ? { archived: "1" } : {}), page: String(page + 1) })}`}>
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>

        <aside className="stack">
          <Fold title="Add a student" padded open={total === 0 && !q}>
            <form action={createStudent} className="stack">
              <StudentFields />
              <SubmitButton variant="primary" icon="plus">Add student</SubmitButton>
            </form>
          </Fold>
          <Fold title="Import from a spreadsheet" padded>
            <form action={importStudents} className="stack">
              <p className="small muted">
                Save your sheet as CSV with columns like <strong>Name, Phone, Email, Guardian, Notes</strong>. Students already
                in your list (same phone or email) are skipped.
              </p>
              <input className="input" type="file" name="file" accept=".csv,text/csv" style={{ paddingTop: 7 }} />
              <SubmitButton icon="upload" pendingText="Importing…">Import students</SubmitButton>
            </form>
          </Fold>
        </aside>
      </div>
    </>
  );
}
