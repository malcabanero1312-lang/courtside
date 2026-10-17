import "server-only";
import { cache } from "react";
import { createAnonClient } from "@/lib/supabase/admin";
import type { AppointmentStatus } from "@/lib/types";

export interface PortalData {
  found: boolean;
  state?: "open" | "answered" | "expired" | "revoked" | "past" | "closed";
  reference?: string;
  status?: AppointmentStatus;
  starts_at?: string;
  ends_at?: string;
  timezone?: string;
  student_first_name?: string;
  coach?: string;
  venue?: string;
  venue_address?: string | null;
  maps_url?: string | null;
  court?: string | null;
  session_type?: string | null;
  org_name?: string;
  brand_color?: string;
  cancellation_policy?: string | null;
  contact_phone?: string | null;
  student_note?: string | null;
}

export const getPortalData = cache(async (token: string): Promise<PortalData> => {
  if (!token || token.length < 24 || token.length > 128) return { found: false };
  try {
    const supabase = createAnonClient();
    const { data } = await supabase.rpc("get_response_page", { p_token: token });
    return (data ?? { found: false }) as PortalData;
  } catch {
    return { found: false };
  }
});

export function portalWhen(page: PortalData): { day: string; time: string } {
  if (!page.starts_at || !page.ends_at || !page.timezone) return { day: "", time: "" };
  const tz = page.timezone;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(page.starts_at)
  );
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return { day, time: `${fmt.format(new Date(page.starts_at))} – ${fmt.format(new Date(page.ends_at))}` };
}
