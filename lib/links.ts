import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/env";

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function responseUrl(token: string): string {
  return `${appUrl()}/r/${token}`;
}

export async function getActiveLinkToken(supabase: SupabaseClient, appointmentId: string): Promise<string | null> {
  const { data } = await supabase
    .from("response_links")
    .select("token, expires_at")
    .eq("appointment_id", appointmentId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.token ?? null;
}

export async function createResponseLink(
  supabase: SupabaseClient,
  input: { orgId: string; appointmentId: string; startsAt: string; linkDays: number; userId?: string | null }
): Promise<string | null> {
  const token = newToken();
  const byDays = Date.now() + input.linkDays * 24 * 3600 * 1000;
  const afterSession = new Date(input.startsAt).getTime() + 24 * 3600 * 1000;
  const expires = new Date(Math.max(Math.min(byDays, afterSession), Date.now() + 3600 * 1000));
  const { error } = await supabase.from("response_links").insert({
    org_id: input.orgId,
    appointment_id: input.appointmentId,
    token,
    expires_at: expires.toISOString(),
    created_by: input.userId ?? null
  });
  return error ? null : token;
}

export async function ensureResponseLink(
  supabase: SupabaseClient,
  input: { orgId: string; appointmentId: string; startsAt: string; linkDays: number; userId?: string | null }
): Promise<string | null> {
  const existing = await getActiveLinkToken(supabase, input.appointmentId);
  if (existing) return existing;
  return createResponseLink(supabase, input);
}
