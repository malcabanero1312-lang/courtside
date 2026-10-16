"use server";

import { randomInt } from "crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { friendlyError, logError } from "@/lib/errors";

export interface InviteState {
  status: "idle" | "error" | "done";
  message?: string;
  email?: string;
  name?: string;
  role?: string;
  password?: string;
  existingAccount?: boolean;
}

const EMAIL = /^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/;

function temporaryPassword(): string {
  const words = ["Court", "Rally", "Serve", "Volley", "Smash", "Match", "Spin", "Lob"];
  const word = words[randomInt(words.length)];
  const digits = String(randomInt(1000, 10000));
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const tail = letters[randomInt(letters.length)] + letters[randomInt(letters.length)];
  return `${word}-${digits}-${tail}`;
}

export async function inviteWithLogin(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { supabase, org, user } = await requireSession(["admin"]);
  const coachId = String(formData.get("coach_id") ?? "").trim() || null;
  let email = String(formData.get("email") ?? "").trim().toLowerCase();
  let name = String(formData.get("full_name") ?? "").trim();
  let role = String(formData.get("role") ?? "agent");
  const createLogin = formData.get("create_login") === "on";

  if (coachId) {
    const { data: coach } = await supabase.from("coaches").select("id, full_name, email, user_id").eq("id", coachId).maybeSingle();
    if (!coach) return { status: "error", message: "Coach not found." };
    if (coach.user_id) return { status: "error", message: "This coach can already log in." };
    if (!coach.email) return { status: "error", message: "Add the coach's email address on their profile first." };
    email = String(coach.email).toLowerCase();
    name = coach.full_name;
    role = "coach";
  }

  if (!EMAIL.test(email)) return { status: "error", message: "Enter a valid email address." };
  if (!["admin", "agent", "coach"].includes(role)) return { status: "error", message: "Choose a role." };

  const { data: member } = await supabase.from("memberships").select("id").eq("org_id", org.id).ilike("email", email).maybeSingle();
  if (member) return { status: "error", message: "This person is already on your team." };

  const { error: inviteError } = await supabase.from("invitations").insert({
    org_id: org.id,
    email,
    role,
    full_name: name || null,
    coach_id: coachId,
    invited_by: user.id
  });
  if (inviteError && inviteError.code !== "23505") {
    return { status: "error", message: friendlyError(inviteError) };
  }

  revalidatePath("/team");
  if (coachId) revalidatePath(`/coaches/${coachId}`);

  if (!createLogin) {
    return { status: "done", email, name, role };
  }

  if (!hasAdminClient()) {
    return {
      status: "error",
      message: "The invitation was saved, but the login couldn't be created because SUPABASE_SERVICE_ROLE_KEY isn't set in Vercel."
    };
  }

  const password = temporaryPassword();
  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name }
  });

  if (createError) {
    const text = createError.message.toLowerCase();
    if (text.includes("already") || text.includes("exists") || text.includes("registered")) {
      return { status: "done", email, name, role, existingAccount: true };
    }
    logError("invite-create-user", createError);
    return {
      status: "error",
      message: "The invitation was saved, but the login couldn't be created. Please try again in a moment."
    };
  }

  return { status: "done", email, name, role, password };
}
