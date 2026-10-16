import "server-only";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { appUrl, emailSettings, isEmailConfigured } from "@/lib/env";
import { buildTemplateVars, renderTemplate } from "@/lib/templates";
import { getActiveLinkToken, responseUrl } from "@/lib/links";
import { logError } from "@/lib/errors";
import { APPOINTMENT_SELECT, type AppointmentWithRelations, type Organization } from "@/lib/types";

const MAX_ATTEMPTS = 5;

interface NotificationRow {
  id: string;
  org_id: string;
  appointment_id: string | null;
  template_key: string;
  recipient_type: "student" | "coach" | "agent";
  attempts: number;
}

export interface WorkerResult {
  ok: boolean;
  remindersQueued: number;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  message?: string;
}

async function sendWithResend(input: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
  idempotencyKey: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string; permanent: boolean }> {
  const { apiKey, from } = emailSettings();
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        reply_to: input.replyTo || undefined
      }),
      signal: AbortSignal.timeout(15000)
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (response.ok && body.id) {
      return { ok: true, id: body.id };
    }
    const permanent = response.status === 400 || response.status === 403 || response.status === 422;
    return {
      ok: false,
      error: `Email provider error ${response.status}: ${(body.message ?? body.name ?? "unknown").slice(0, 200)}`,
      permanent
    };
  } catch (error) {
    return { ok: false, error: `Could not reach the email provider: ${String(error).slice(0, 150)}`, permanent: false };
  }
}

function backoffMinutes(attempts: number): number {
  return Math.min(5 * 2 ** Math.max(0, attempts - 1), 360);
}

async function processOne(admin: ReturnType<typeof createAdminClient>, row: NotificationRow) {
  const finish = async (fields: Record<string, unknown>) => {
    await admin.from("notifications").update({ ...fields, locked_at: null }).eq("id", row.id);
  };

  if (!row.appointment_id) {
    await finish({ status: "skipped", last_error: "The appointment no longer exists." });
    return "skipped" as const;
  }

  const [{ data: appointment }, { data: org }, { data: template }] = await Promise.all([
    admin.from("appointments").select(APPOINTMENT_SELECT).eq("id", row.appointment_id).maybeSingle(),
    admin.from("organizations").select("*").eq("id", row.org_id).maybeSingle(),
    admin
      .from("message_templates")
      .select("subject, body")
      .eq("org_id", row.org_id)
      .eq("channel", "email")
      .eq("key", row.template_key)
      .maybeSingle()
  ]);

  if (!appointment || !org) {
    await finish({ status: "skipped", last_error: "The appointment no longer exists." });
    return "skipped" as const;
  }
  if (!template) {
    await finish({ status: "skipped", last_error: `No email template named "${row.template_key}". Add it under Settings → Templates.` });
    return "skipped" as const;
  }

  const appt = appointment as unknown as AppointmentWithRelations;
  let recipient: string | null = null;
  if (row.recipient_type === "student") {
    if (appt.student && !appt.student.email_opt_in) {
      await finish({ status: "skipped", last_error: "Student has turned off email updates." });
      return "skipped" as const;
    }
    recipient = appt.student?.email ?? null;
  } else if (row.recipient_type === "coach") {
    recipient = appt.coach?.email ?? null;
  } else {
    recipient = appt.agent?.email ?? null;
  }

  if (!recipient) {
    const who = row.recipient_type === "agent" ? "assigned agent" : row.recipient_type;
    await finish({ status: "skipped", last_error: `No email address on file for the ${who}.` });
    return "skipped" as const;
  }

  if (!isEmailConfigured()) {
    await finish({
      status: "skipped",
      recipient_email: recipient,
      last_error: "Email sending is not set up yet (RESEND_API_KEY / EMAIL_FROM missing). Nothing was sent."
    });
    return "skipped" as const;
  }

  const token = await getActiveLinkToken(admin, appt.id);
  const vars = buildTemplateVars({
    appointment: appt,
    org: org as Organization,
    responseLink: token ? responseUrl(token) : "",
    appointmentUrl: `${appUrl()}/appointments/${appt.id}`
  });
  const subject = renderTemplate(template.subject ?? "Tennis session update", vars).replace(/\s+/g, " ");
  const text = renderTemplate(template.body, vars);

  const result = await sendWithResend({
    to: recipient,
    subject,
    text,
    replyTo: (org as Organization).reply_to_email,
    idempotencyKey: `notification-${row.id}`
  });

  if (result.ok) {
    await finish({
      status: "sent",
      recipient_email: recipient,
      subject,
      provider_message_id: result.id,
      sent_at: new Date().toISOString(),
      last_error: null
    });
    return "sent" as const;
  }

  const giveUp = result.permanent || row.attempts >= MAX_ATTEMPTS;
  await finish({
    status: giveUp ? "dead" : "failed",
    recipient_email: recipient,
    subject,
    last_error: result.error,
    next_attempt_at: new Date(Date.now() + backoffMinutes(row.attempts) * 60000).toISOString()
  });
  return "failed" as const;
}

export async function runNotificationWorker(options: { limit?: number; queueReminders?: boolean } = {}): Promise<WorkerResult> {
  const result: WorkerResult = { ok: true, remindersQueued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 };
  if (!hasAdminClient()) {
    return { ...result, ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not set, so notifications cannot be processed." };
  }
  const admin = createAdminClient();

  try {
    if (options.queueReminders !== false) {
      const { data: queued, error } = await admin.rpc("queue_due_reminders");
      if (error) logError("reminders", error);
      result.remindersQueued = Number(queued ?? 0);
    }

    const { data: rows, error } = await admin.rpc("claim_notifications", { p_limit: options.limit ?? 25 });
    if (error) {
      logError("claim", error);
      return { ...result, ok: false, message: "Could not read the notification queue." };
    }

    for (const row of (rows ?? []) as NotificationRow[]) {
      result.processed += 1;
      try {
        const outcome = await processOne(admin, row);
        result[outcome] += 1;
      } catch (err) {
        logError("notification", err);
        result.failed += 1;
        await admin
          .from("notifications")
          .update({
            status: row.attempts >= MAX_ATTEMPTS ? "dead" : "failed",
            locked_at: null,
            last_error: "Unexpected error while preparing this email.",
            next_attempt_at: new Date(Date.now() + backoffMinutes(row.attempts) * 60000).toISOString()
          })
          .eq("id", row.id);
      }
    }

    await admin.from("system_status").upsert({
      key: "notification_worker",
      value: { at: new Date().toISOString(), ...result },
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    logError("worker", err);
    return { ...result, ok: false, message: "The notification worker stopped unexpectedly. Check the server logs." };
  }

  return result;
}

export async function processNotificationsSoon(): Promise<void> {
  try {
    await runNotificationWorker({ limit: 10, queueReminders: false });
  } catch (err) {
    logError("worker-inline", err);
  }
}
