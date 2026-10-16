"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { runNotificationWorker } from "@/lib/notifications";
import { friendlyError } from "@/lib/errors";

function back(kind: "notice" | "error", message: string): never {
  redirect(`/notifications?${kind}=${encodeURIComponent(message)}`);
}

export async function retryNotification(formData: FormData) {
  const { supabase, org } = await requireSession(["admin", "agent"]);
  const id = String(formData.get("id") ?? "");
  const query = supabase
    .from("notifications")
    .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null, locked_at: null })
    .eq("org_id", org.id)
    .in("status", ["failed", "dead", "skipped"]);
  const { error } = id === "all-failed" ? await query.in("status", ["failed", "dead"]) : await query.eq("id", id);
  if (error) back("error", friendlyError(error));
  const result = await runNotificationWorker({ limit: 25, queueReminders: false });
  revalidatePath("/notifications");
  if (!result.ok) back("error", result.message ?? "Couldn't process the queue.");
  back("notice", `Tried again: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`);
}

export async function runNow() {
  await requireSession(["admin", "agent"]);
  const result = await runNotificationWorker({ limit: 50 });
  revalidatePath("/notifications");
  if (!result.ok) back("error", result.message ?? "Couldn't process the queue.");
  back(
    "notice",
    `Done: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped, ${result.remindersQueued} reminder${result.remindersQueued === 1 ? "" : "s"} queued.`
  );
}
