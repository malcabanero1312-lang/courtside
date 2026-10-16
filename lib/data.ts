import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Coach, Court, Membership, SessionType, Venue } from "@/lib/types";

export interface ReferenceData {
  coaches: Coach[];
  venues: Venue[];
  courts: Court[];
  sessionTypes: SessionType[];
  agents: Pick<Membership, "id" | "full_name" | "email" | "role" | "user_id">[];
}

export async function loadReferenceData(supabase: SupabaseClient, orgId: string): Promise<ReferenceData> {
  const [coaches, venues, courts, sessionTypes, agents] = await Promise.all([
    supabase.from("coaches").select("*").eq("org_id", orgId).order("full_name"),
    supabase.from("venues").select("*").eq("org_id", orgId).order("name"),
    supabase.from("courts").select("*").eq("org_id", orgId).order("name"),
    supabase.from("session_types").select("*").eq("org_id", orgId).order("name"),
    supabase
      .from("memberships")
      .select("id, full_name, email, role, user_id")
      .eq("org_id", orgId)
      .in("role", ["admin", "agent"])
      .order("full_name")
  ]);
  return {
    coaches: (coaches.data ?? []) as Coach[],
    venues: (venues.data ?? []) as Venue[],
    courts: (courts.data ?? []) as Court[],
    sessionTypes: (sessionTypes.data ?? []) as SessionType[],
    agents: (agents.data ?? []) as ReferenceData["agents"]
  };
}
