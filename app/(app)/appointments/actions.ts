"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { checkSlot, validateSlotInput, type SlotInput } from "@/lib/scheduling";
import { createResponseLink } from "@/lib/links";
import { friendlyError } from "@/lib/errors";
import { normalizePhone } from "@/lib/whatsapp";
import { processNotificationsSoon } from "@/lib/notifications";
import type { AppointmentStatus, SlotIssue, SlotSuggestion } from "@/lib/types";

export interface AppointmentFormState {
  status: "idle" | "error" | "conflict" | "warning" | "duplicate";
  message?: string;
  issues?: SlotIssue[];
  suggestions?: SlotSuggestion[];
  duplicates?: { id: string; full_name: string; phone: string | null; email: string | null }[];
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(path: string, kind: "notice" | "error", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${kind}=${encodeURIComponent(message)}`);
}

export async function saveAppointment(_prev: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  const { supabase, org, user, membership } = await requireSession(["admin", "agent"]);
  const mode = text(formData, "mode") === "reschedule" ? "reschedule" : "create";
  const appointmentId = text(formData, "appointment_id") || null;
  const version = Number(text(formData, "version")) || null;

  let studentId = text(formData, "student_id") || null;
  const newStudent = {
    full_name: text(formData, "new_student_name"),
    phone: normalizePhone(text(formData, "new_student_phone"), org.default_country_code),
    rawPhone: text(formData, "new_student_phone"),
    email: text(formData, "new_student_email").toLowerCase() || null,
    guardian_name: text(formData, "new_student_guardian") || null
  };

  if (mode === "create" && !studentId) {
    if (!newStudent.full_name) {
      return { status: "error", message: "Choose a student or enter a new student's name." };
    }
    if (newStudent.rawPhone && !newStudent.phone) {
      return { status: "error", message: "That phone number doesn't look right. Include the area code, e.g. 0917 123 4567." };
    }
    if (!newStudent.phone && !newStudent.email) {
      return { status: "error", message: "Add a WhatsApp number or an email so the student can be contacted." };
    }
    if (newStudent.email && !/^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/.test(newStudent.email)) {
      return { status: "error", message: "That email address doesn't look right." };
    }
    if (text(formData, "confirm_new_student") !== "1") {
      const filters: string[] = [];
      if (newStudent.phone) filters.push(`phone.eq.${newStudent.phone}`);
      if (newStudent.email) filters.push(`email.ilike.${newStudent.email}`);
      const { data: matches } = await supabase
        .from("students")
        .select("id, full_name, phone, email")
        .eq("org_id", org.id)
        .or(filters.join(","))
        .limit(5);
      if (matches && matches.length > 0) {
        return {
          status: "duplicate",
          message: "We found students with the same phone or email. Is it one of them?",
          duplicates: matches
        };
      }
    }
  }

  const slot: SlotInput = {
    coachId: text(formData, "coach_id"),
    venueId: text(formData, "venue_id"),
    courtId: text(formData, "court_id") || null,
    studentId,
    date: text(formData, "date"),
    time: text(formData, "time"),
    duration: Number(text(formData, "duration")),
    excludeId: mode === "reschedule" ? appointmentId : null
  };

  const invalid = validateSlotInput(slot);
  if (invalid) return { status: "error", message: invalid };

  const check = await checkSlot(supabase, org, slot);
  const blocking = check.issues.filter((issue) => issue.severity === "block");
  if (blocking.length > 0) {
    return {
      status: "conflict",
      message: "This time isn't available.",
      issues: check.issues,
      suggestions: check.suggestions
    };
  }
  if (check.issues.length > 0 && text(formData, "acknowledge") !== "1") {
    return {
      status: "warning",
      message: "Please double-check before saving.",
      issues: check.issues
    };
  }

  let newId: string | null = null;

  if (mode === "create") {
    if (!studentId) {
      const { data: created, error: studentError } = await supabase
        .from("students")
        .insert({
          org_id: org.id,
          full_name: newStudent.full_name,
          phone: newStudent.phone,
          email: newStudent.email,
          guardian_name: newStudent.guardian_name,
          preferred_channel: newStudent.phone ? "whatsapp" : "email",
          created_by: user.id
        })
        .select("id")
        .single();
      if (studentError || !created) {
        return { status: "error", message: friendlyError(studentError, "Couldn't save the new student.") };
      }
      studentId = created.id as string;
    }

    const { data, error } = await supabase.rpc("create_appointment", {
      p_org: org.id,
      p_student: studentId,
      p_coach: slot.coachId,
      p_venue: slot.venueId,
      p_court: slot.courtId,
      p_session_type: text(formData, "session_type_id") || null,
      p_local_start: `${slot.date} ${slot.time}:00`,
      p_duration_minutes: slot.duration,
      p_agent: text(formData, "agent_id") || membership.id,
      p_notes: text(formData, "notes")
    });
    if (error || !data) {
      if (error?.code === "23P01") {
        const recheck = await checkSlot(supabase, org, { ...slot, studentId });
        return {
          status: "conflict",
          message: "Someone booked this time a moment ago.",
          issues: recheck.issues,
          suggestions: recheck.suggestions
        };
      }
      return { status: "error", message: friendlyError(error, "Couldn't create the appointment.") };
    }
    newId = String(data);
  } else {
    if (!appointmentId) return { status: "error", message: "Appointment not found." };
    const { data, error } = await supabase.rpc("reschedule_appointment", {
      p_appointment: appointmentId,
      p_coach: slot.coachId,
      p_venue: slot.venueId,
      p_court: slot.courtId,
      p_local_start: `${slot.date} ${slot.time}:00`,
      p_duration_minutes: slot.duration,
      p_expected_version: version
    });
    if (error || !data) {
      if (error?.code === "23P01") {
        const recheck = await checkSlot(supabase, org, slot);
        return {
          status: "conflict",
          message: "Someone booked this time a moment ago.",
          issues: recheck.issues,
          suggestions: recheck.suggestions
        };
      }
      return { status: "error", message: friendlyError(error, "Couldn't reschedule the appointment.") };
    }
    newId = String(data);
    after(processNotificationsSoon);
  }

  await createResponseLink(supabase, {
    orgId: org.id,
    appointmentId: newId,
    startsAt: check.startsAt ?? new Date().toISOString(),
    linkDays: org.response_link_days,
    userId: user.id
  });

  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  const notice = mode === "create" ? "Appointment booked. Send the WhatsApp message below." : "Appointment moved. Send the new time to the student below.";
  redirect(`/appointments/${newId}?send=1&notice=${encodeURIComponent(notice)}`);
}

const STAFF_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "awaiting_response",
  "pending_approval",
  "confirmed",
  "declined",
  "cancelled",
  "completed",
  "no_show",
  "reschedule_requested"
];

export async function changeStatus(formData: FormData) {
  const { supabase } = await requireSession();
  const id = text(formData, "id");
  const status = text(formData, "status") as AppointmentStatus;
  const reason = text(formData, "reason");
  const version = Number(text(formData, "version")) || null;
  const path = `/appointments/${id}`;
  if (!STAFF_STATUSES.includes(status)) back(path, "error", "Unknown status.");

  const { error } = await supabase.rpc("change_appointment_status", {
    p_appointment: id,
    p_status: status,
    p_reason: reason || null,
    p_expected_version: version
  });
  if (error) {
    back(
      path,
      "error",
      error.code === "23P01"
        ? "That time is now taken by another booking, so it can't be restored. Use Reschedule to pick a new time."
        : friendlyError(error)
    );
  }
  if (status === "confirmed") {
    await supabase.from("appointments").update({ student_informed_at: new Date().toISOString() }).eq("id", id).eq("office_approved", true);
  }
  after(processNotificationsSoon);
  revalidatePath(path);
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  const messages: Partial<Record<AppointmentStatus, string>> = {
    pending_approval: "Recorded that the student confirmed. Next, send the booking to the office for approval.",
    confirmed: "Marked as confirmed.",
    cancelled: "Appointment cancelled. The student's link has been switched off.",
    completed: "Marked as completed.",
    no_show: "Marked as no-show.",
    scheduled: "Appointment restored.",
    awaiting_response: "Marked as awaiting reply.",
    declined: "Marked as declined."
  };
  back(path, "notice", messages[status] ?? "Status updated.");
}

export async function logWhatsApp(
  appointmentId: string,
  kind: "opened" | "sent",
  templateKey: string,
  target: "student" | "office" = "student"
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireSession();
  const eventType =
    target === "office"
      ? kind === "opened"
        ? "office_message_opened"
        : "office_messaged"
      : kind === "opened"
        ? "whatsapp_opened"
        : "whatsapp_marked_sent";
  const { error } = await supabase.rpc("log_appointment_event", {
    p_appointment: appointmentId,
    p_event_type: eventType,
    p_details: { template: templateKey }
  });
  if (error) return { ok: false, error: friendlyError(error) };
  if (kind === "sent") {
    revalidatePath(`/appointments/${appointmentId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard");
  }
  return { ok: true };
}

export async function recordOfficeApproved(formData: FormData) {
  await saveOfficeDecision(formData, "approved");
}

export async function recordOfficeNotApproved(formData: FormData) {
  await saveOfficeDecision(formData, "not_approved");
}

async function saveOfficeDecision(formData: FormData, decision: "approved" | "not_approved") {
  const { supabase } = await requireSession();
  const id = text(formData, "id");
  const path = `/appointments/${id}`;
  const { error } = await supabase.rpc("record_office_decision", {
    p_appointment: id,
    p_decision: decision,
    p_note: text(formData, "office_note") || null,
    p_expected_version: Number(text(formData, "version")) || null
  });
  if (error) back(path, "error", friendlyError(error));
  after(processNotificationsSoon);
  revalidatePath(path);
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  back(
    path,
    "notice",
    decision === "approved"
      ? "Saved: the office approved. Now send the good news to the student below."
      : "Saved: the office didn't approve. Let the student know below. The time slot is free again."
  );
}

export async function logLinkCopied(appointmentId: string): Promise<void> {
  const { supabase } = await requireSession(["admin", "agent"]);
  await supabase.rpc("log_appointment_event", { p_appointment: appointmentId, p_event_type: "link_copied", p_details: {} });
}

export async function regenerateLink(formData: FormData) {
  const { supabase, org, user } = await requireSession(["admin", "agent"]);
  const id = text(formData, "id");
  const path = `/appointments/${id}`;
  const { data: appointment } = await supabase.from("appointments").select("id, starts_at").eq("id", id).maybeSingle();
  if (!appointment) back("/appointments", "error", "Appointment not found.");

  await supabase.from("response_links").update({ revoked_at: new Date().toISOString() }).eq("appointment_id", id).is("revoked_at", null);
  const token = await createResponseLink(supabase, {
    orgId: org.id,
    appointmentId: id,
    startsAt: appointment.starts_at,
    linkDays: org.response_link_days,
    userId: user.id
  });
  if (!token) back(path, "error", "Couldn't create a new link. Please try again.");
  await supabase.rpc("log_appointment_event", { p_appointment: id, p_event_type: "link_regenerated", p_details: {} });
  revalidatePath(path);
  back(path, "notice", "New response link created. The old link no longer works.");
}

export async function updateAppointmentDetails(formData: FormData) {
  const { supabase, membership } = await requireSession();
  const id = text(formData, "id");
  const path = `/appointments/${id}`;
  const update: Record<string, unknown> = { notes: text(formData, "notes") || null };
  if (membership.role !== "coach") {
    update.assigned_agent_id = text(formData, "agent_id") || null;
    update.session_type_id = text(formData, "session_type_id") || null;
  }
  const { error } = await supabase.from("appointments").update(update).eq("id", id);
  if (error) back(path, "error", friendlyError(error));
  revalidatePath(path);
  back(path, "notice", "Details saved.");
}

export async function bulkAction(formData: FormData) {
  const { supabase } = await requireSession(["admin", "agent"]);
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, 200);
  const action = text(formData, "bulk_action");
  const returnTo = text(formData, "return_to") || "/appointments";
  const safeReturn = returnTo.startsWith("/appointments") ? returnTo : "/appointments";
  if (ids.length === 0) back(safeReturn, "error", "Select at least one appointment first.");
  const allowed: Record<string, AppointmentStatus> = {
    complete: "completed",
    no_show: "no_show",
    cancel: "cancelled",
    confirm: "pending_approval",
    office_approved: "confirmed"
  };
  const status = allowed[action];
  if (!status) back(safeReturn, "error", "Choose what to do with the selected appointments.");

  let done = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const { error } =
      action === "office_approved"
        ? await supabase.rpc("record_office_decision", {
            p_appointment: id,
            p_decision: "approved",
            p_note: null,
            p_expected_version: null
          })
        : await supabase.rpc("change_appointment_status", {
            p_appointment: id,
            p_status: status,
            p_reason: status === "cancelled" ? "Cancelled in bulk" : null,
            p_expected_version: null
          });
    if (error) failed.push(id);
    else done += 1;
  }
  after(processNotificationsSoon);
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  if (failed.length > 0) {
    back(safeReturn, "error", `Updated ${done}. ${failed.length} couldn't be changed (their current status doesn't allow it).`);
  }
  back(safeReturn, "notice", `Updated ${done} appointment${done === 1 ? "" : "s"}.`);
}

export async function saveView(formData: FormData) {
  const { supabase, org, user } = await requireSession();
  const name = text(formData, "name").slice(0, 60);
  const query = text(formData, "query").replace(/^\?/, "");
  if (!name) back(`/appointments?${query}`, "error", "Give the view a name.");
  const cleaned = new URLSearchParams(query);
  cleaned.delete("notice");
  cleaned.delete("error");
  cleaned.delete("page");
  await supabase.from("saved_views").insert({ org_id: org.id, user_id: user.id, name, query: cleaned.toString() });
  revalidatePath("/appointments");
  back(`/appointments?${cleaned.toString()}`, "notice", `Saved view “${name}”.`);
}

export async function deleteView(formData: FormData) {
  const { supabase } = await requireSession();
  await supabase.from("saved_views").delete().eq("id", text(formData, "id"));
  revalidatePath("/appointments");
  redirect("/appointments");
}
