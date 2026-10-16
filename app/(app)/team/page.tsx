import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import type { Membership } from "@/lib/types";
import { formatDate, initials } from "@/lib/format";
import { Card, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/buttons";
import { changeRole, inviteMember, removeMember, revokeInvitation, updateMyProfile } from "./actions";

export const metadata: Metadata = { title: "Team" };

const ROLE_HELP: Record<string, string> = {
  admin: "Everything, including settings, team and templates",
  agent: "Books and manages appointments, students and messages",
  coach: "Sees their own sessions, marks attendance, sets their hours"
};

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
          <Card title="Invite someone" padded>
            <form action={inviteMember} className="stack">
              <label className="field">
                <span>Name</span>
                <input className="input" name="full_name" placeholder="Paolo Cruz" />
              </label>
              <label className="field">
                <span>Email</span>
                <input className="input" type="email" name="email" required placeholder="paolo@club.com" />
              </label>
              <div className="stack tight">
                <span className="label">Role</span>
                {(["agent", "coach", "admin"] as const).map((role) => (
                  <label key={role} className="choice" style={{ padding: "10px 12px" }}>
                    <input type="radio" name="role" value={role} defaultChecked={role === "agent"} />
                    <div>
                      <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{role}</div>
                      <div className="small muted">{ROLE_HELP[role]}</div>
                    </div>
                  </label>
                ))}
              </div>
              <SubmitButton variant="primary" icon="send">Create invitation</SubmitButton>
              <p className="small muted">
                For coaches, it's best to invite from the coach's own page so their login is linked to their schedule.
              </p>
            </form>
          </Card>
          <Card title="Your name" padded>
            <form action={updateMyProfile} className="stack">
              <input className="input" name="full_name" defaultValue={membership.full_name} placeholder="Shown in WhatsApp messages" />
              <SubmitButton size="small">Save</SubmitButton>
            </form>
          </Card>
        </aside>
      </div>
    </>
  );
}
