import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Membership, Organization, Role } from "@/lib/types";

export const ORG_COOKIE = "courtside_org";

type MembershipWithOrg = Membership & { organization: Organization };

async function loadMemberships(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("memberships")
    .select("*, organization:organizations(*)")
    .eq("user_id", userId)
    .order("created_at");
  return (data ?? []) as MembershipWithOrg[];
}

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  let memberships = await loadMemberships(supabase, user.id);
  if (memberships.length === 0) {
    const { data: accepted } = await supabase.rpc("accept_invitations");
    if (accepted && Number(accepted) > 0) {
      memberships = await loadMemberships(supabase, user.id);
    }
  }

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.org_id === preferred) ?? memberships[0] ?? null;

  return {
    supabase,
    user,
    memberships,
    membership: current as MembershipWithOrg | null,
    org: current?.organization ?? null
  };
});

export async function requireSession(roles?: Role[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.membership || !session.org) redirect("/onboarding");
  if (roles && !roles.includes(session.membership.role)) {
    redirect("/dashboard?error=" + encodeURIComponent("That page is only available to " + roles.join(" or ") + "s."));
  }
  return {
    supabase: session.supabase,
    user: session.user,
    memberships: session.memberships,
    membership: session.membership,
    org: session.org
  };
}

export function isStaff(role: Role): boolean {
  return role === "admin" || role === "agent";
}
