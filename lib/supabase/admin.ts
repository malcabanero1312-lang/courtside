import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "@/lib/env";

export function hasAdminClient(): boolean {
  return Boolean(publicEnv.supabaseUrl && serviceRoleKey());
}

export function createAdminClient() {
  const key = serviceRoleKey();
  if (!publicEnv.supabaseUrl || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }
  return createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function createAnonClient() {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
