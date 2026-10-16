import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import type { Coach } from "@/lib/types";
import { Card, EmptyState, Flash, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/buttons";
import { initials } from "@/lib/format";
import { CoachFields } from "./coach-fields";
import { createCoach } from "./actions";

export const metadata: Metadata = { title: "Coaches" };

export default async function CoachesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership, user } = await requireSession();
  const { data } = await supabase.from("coaches").select("*").eq("org_id", org.id).order("is_active", { ascending: false }).order("full_name");
  const coaches = (data ?? []) as Coach[];

  if (membership.role === "coach") {
    const mine = coaches.find((c) => c.user_id === user.id);
    if (mine) redirect(`/coaches/${mine.id}`);
  }

  const { data: recent } = await supabase
    .from("appointments")
    .select("coach_id, status")
    .eq("org_id", org.id)
    .gte("starts_at", new Date().toISOString())
    .in("status", ["scheduled", "awaiting_response", "pending_approval", "confirmed", "reschedule_requested"]);
  const upcomingByCoach = new Map<string, number>();
  for (const row of (recent ?? []) as { coach_id: string }[]) {
    upcomingByCoach.set(row.coach_id, (upcomingByCoach.get(row.coach_id) ?? 0) + 1);
  }

  return (
    <>
      <Flash params={params} />
      <PageHeader title="Coaches" subtitle="Each coach has their own working hours and time off. Bookings outside them are flagged." />
      <div className="grid main-side">
        <Card>
          {coaches.length === 0 ? (
            <EmptyState icon="whistle" title="No coaches yet" body="Add your first coach to start booking sessions." />
          ) : (
            <div className="list">
              {coaches.map((coach) => (
                <Link key={coach.id} href={`/coaches/${coach.id}`} className="list-item">
                  <div className="avatar" style={{ background: coach.color, color: "#fff" }}>
                    {initials(coach.full_name)}
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 650 }}>
                      {coach.full_name} {!coach.is_active ? <span className="badge plain tone-muted">Inactive</span> : null}
                    </div>
                    <div className="small muted truncate">
                      {[coach.specialties, coach.email, coach.user_id ? "Can log in" : null].filter(Boolean).join(" · ") || "No details yet"}
                    </div>
                  </div>
                  <div className="small muted nowrap hide-mobile">{upcomingByCoach.get(coach.id) ?? 0} upcoming</div>
                  <Icon name="chevronRight" size={16} />
                </Link>
              ))}
            </div>
          )}
        </Card>
        {membership.role === "admin" ? (
          <Card title="Add a coach" padded>
            <form action={createCoach} className="stack">
              <CoachFields />
              <SubmitButton variant="primary" icon="plus">Add coach</SubmitButton>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
