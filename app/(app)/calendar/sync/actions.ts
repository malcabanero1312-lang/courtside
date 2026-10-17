"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { logError } from "@/lib/errors";

function token(): string {
  return randomBytes(24).toString("base64url");
}

export async function createCalendarFeed() {
  const { supabase, org, membership } = await requireSession();
  const { data: existing } = await supabase.from("calendar_feeds").select("id").eq("membership_id", membership.id).maybeSingle();
  if (!existing) {
    const { error } = await supabase.from("calendar_feeds").insert({ org_id: org.id, membership_id: membership.id, token: token() });
    if (error) {
      logError("calendar-feed-create", error);
      redirect(
        `/calendar/sync?error=${encodeURIComponent("The database needs update 0013 first. In Supabase → SQL Editor, run supabase/migrations/0013_calendar_feeds_and_coach_sheet_names.sql.")}`
      );
    }
  }
  revalidatePath("/calendar/sync");
  redirect("/calendar/sync");
}

export async function resetCalendarFeed() {
  const { supabase, membership } = await requireSession();
  const { error } = await supabase.from("calendar_feeds").update({ token: token(), last_fetched_at: null }).eq("membership_id", membership.id);
  if (error) logError("calendar-feed-reset", error);
  revalidatePath("/calendar/sync");
  redirect(`/calendar/sync?notice=${encodeURIComponent("New link created. The old link stopped working — subscribe again with the new one.")}`);
}
