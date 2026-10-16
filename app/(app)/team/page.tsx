import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import type { Membership } from "@/lib/types";
import { formatDate, initials } from "@/lib/format";
import { Card, Flash, Fold, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { changeRole, removeMember, revokeInvitation } from "./actions";
import { InviteForm } from "@/components/invite-form";
import { appUrl } from "@/lib/env";

export const metadata: Metadata = { title: "Team" };


export default async function TeamPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { supabase, org, membership } = await requireSession(["admin"]);
  const [membersRes, invitesRes] = await Promise.all([
    supabase.from("memberships").select("*").eq("org_id", org.id).order("created_at"),
    supabase.from("invitations").select("*").eq("org_id", org.id).is("accepted_at", null).is("revoked_at", null).order("created_at")
  ]);
  const members = (membersRes.data ?? []) as (Membership & { created_at: string })[];
  const invites = (invitesRes.data ?? []) as { id: string; email: string; role: string; created_at: string; full_name: string | null }[];

  return (
    <>
      <Flash params={params} />
      <PageHeader title="Team" subtitle="Invite agents and coaches. Each person only sees what their role allows." />
      <div className="grid main-side">
        <div className="stack">
          <Card title={`Members (${members.length})`}>
            <div className="list">
              {members.map((m) => (
                <div key={m.id} className="list-item">
                  <div className="avatar">{initials(m.full_name || m.email)}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>
                      {m.full_name || m.email} {m.id === membership.id ? <span className="badge plain tone-ball">You</span> : null}
                    </div>
                    <div className="small muted">{m.email}</div>
                  </div>
                  <form action={changeRole} className="row">
                    <input type="hidden" name="id" value={m.id} />
                    <select className="input" name="role" defaultValue={m.role} style={{ width: 110, height: 32 }} aria-label="Role">
                      <option value="admin">Admin</option>
                      <option value="agent">Agent</option>
                      <option value="coach">Coach</option>
                    </select>
                    <SubmitButton size="small">Save</SubmitButton>
                  </form>
                  {m.id !== membership.id ? (
                    <form action={removeMember}>
                      <input type="hidden" name="id" value={m.id} />
                      <SubmitButton size="small" variant="ghost" icon="trash" confirmText={`Remove ${m.full_name || m.email} from the team?`}>
                        <span className="sr-only">Remove</span>
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Pending invitations">
            {invites.length === 0 ? (
              <div className="card-body small muted">No pending invitations.</div>
            ) : (
              <div className="list">
                {invites.map((invite) => (
                  <div key={invite.id} className="list-item">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{invite.full_name || invite.email}</div>
                      <div className="small muted">
                        {invite.email} · {invite.role} · invited {formatDate(invite.created_at, org.timezone, "short")}
                      </div>
                    </div>
                    <form action={revokeInvitation}>
                      <input type="hidden" name="id" value={invite.id} />
                      <SubmitButton size="small" variant="ghost">Cancel</SubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="stack">
          <Fold title="Invite someone" padded open={members.length <= 1}>
            <InviteForm appUrl={appUrl()} orgName={org.name} />
          </Fold>
        </aside>
      </div>
    </>
  );
}
