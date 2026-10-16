"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { normalizePhone } from "@/lib/whatsapp";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(path: string, kind: "notice" | "error", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function updateOrganization(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const replyTo = text(formData, "reply_to_email").toLowerCase();
  if (replyTo && !/^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/.test(replyTo)) back("/settings", "error", "The reply-to email doesn't look right.");
  const color = text(formData, "brand_color");
  const rawOfficePhone = text(formData, "office_phone");
  const officePhone = normalizePhone(rawOfficePhone, org.default_country_code);
  if (rawOfficePhone && !officePhone) back("/settings", "error", "The office WhatsApp number doesn't look right. Include the area code.");
  const rawContactPhone = text(formData, "contact_phone");
  const contactPhone = normalizePhone(rawContactPhone, org.default_country_code);
  if (rawContactPhone && !contactPhone) back("/settings", "error", "The student contact number doesn't look right. Include the area code.");
  const { error } = await supabase
    .from("organizations")
    .update({
      name: text(formData, "name") || org.name,
      timezone: text(formData, "timezone") || org.timezone,
      default_country_code: text(formData, "default_country_code").replace(/\D/g, "") || org.default_country_code,
      default_duration_minutes: clampInt(text(formData, "default_duration_minutes"), 15, 480, org.default_duration_minutes),
      slot_step_minutes: [10, 15, 20, 30, 60].includes(Number(text(formData, "slot_step_minutes")))
        ? Number(text(formData, "slot_step_minutes"))
        : org.slot_step_minutes,
      reminder_hours_before: clampInt(text(formData, "reminder_hours_before"), 0, 168, org.reminder_hours_before),
      response_link_days: clampInt(text(formData, "response_link_days"), 1, 90, org.response_link_days),
      follow_up_after_hours: clampInt(text(formData, "follow_up_after_hours"), 1, 168, org.follow_up_after_hours),
      brand_color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : org.brand_color,
      reply_to_email: replyTo || null,
      notify_student_email: formData.get("notify_student_email") === "on",
      notify_coach_email: formData.get("notify_coach_email") === "on",
      notify_agent_email: formData.get("notify_agent_email") === "on",
      cancellation_policy: text(formData, "cancellation_policy") || null,
      office_name: text(formData, "office_name") || null,
      office_phone: officePhone,
      contact_phone: contactPhone
    })
    .eq("id", org.id);
  if (error) back("/settings", "error", friendlyError(error));
  revalidatePath("/", "layout");
  back("/settings", "notice", "Settings saved.");
}

export async function addSessionType(formData: FormData) {
  const { supabase, org } = await requireSession(["admin"]);
  const name = text(formData, "name");
  if (!name) back("/settings", "error", "Enter a name for the session type.");
  const { error } = await supabase.from("session_types").insert({
    org_id: org.id,
    name,
    duration_minutes: clampInt(text(formData, "duration_minutes"), 15, 480, 60)
  });
  if (error) back("/settings", "error", error.code === "23505" ? "A session type with this name already exists." : friendlyError(error));
  revalidatePath("/settings");
  back("/settings", "notice", "Session type added.");
}

export async function updateSessionType(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const { error } = await supabase
    .from("session_types")
    .update({
      duration_minutes: clampInt(text(formData, "duration_minutes"), 15, 480, 60),
      is_active: formData.get("is_active") === "on"
    })
    .eq("id", text(formData, "id"));
  if (error) back("/settings", "error", friendlyError(error));
  revalidatePath("/settings");
  back("/settings", "notice", "Session type updated.");
}

export async function updateTemplate(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const body = String(formData.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) back("/settings/templates", "error", "A template can't be empty.");
  if (body.length > 4000) back("/settings/templates", "error", "Templates can be at most 4,000 characters.");
  const { error } = await supabase
    .from("message_templates")
    .update({
      name: text(formData, "name") || "Template",
      subject: text(formData, "subject") || null,
      body
    })
    .eq("id", text(formData, "id"));
  if (error) back("/settings/templates", "error", friendlyError(error));
  revalidatePath("/settings/templates");
  back("/settings/templates", "notice", "Template saved.");
}

export async function restoreTemplates() {
  const { supabase, org } = await requireSession(["admin"]);
  const { error } = await supabase.rpc("restore_default_templates", { p_org: org.id });
  if (error) back("/settings/templates", "error", friendlyError(error));
  revalidatePath("/settings/templates");
  back("/settings/templates", "notice", "Any missing default templates were added back. Your edited ones were kept.");
}
