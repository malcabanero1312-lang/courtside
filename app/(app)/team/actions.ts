"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function back(kind: "notice" | "error", message: string): never {
  redirect(`/team?${kind}=${encodeURIComponent(message)}`);
}

export async function inviteMember(formData: FormData) {
  const { supabase, org, user } = await requireSession(["admin"]);
  const email = text(formData, "email").toLowerCase();
  const role = text(formData, "role");
  if (!/^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/.test(email)) back("error", "Enter a valid email address.");
  if (!["admin", "agent", "coach"].includes(role)) back("error", "Choose a role.");
  const { data: existing } = await supabase.from("memberships").select("id").eq("org_id", org.id).ilike("email", email).maybeSingle();
  if (existing) back("error", "This person is already on your team.");
  const { error } = await supabase.from("invitations").insert({
    org_id: org.id,
    email,
    role,
    full_name: text(formData, "full_name") || null,
    invited_by: user.id
  });
  if (error) back("error", error.code === "23505" ? "There's already an open invitation for this email." : friendlyError(error));
  revalidatePath("/team");
  back("notice", `Invitation created. Ask them to sign up with ${email} — they'll join automatically after confirming their email.`);
}

export async function revokeInvitation(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const { error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", text(formData, "id"));
  if (error) back("error", friendlyError(error));
  revalidatePath("/team");
  back("notice", "Invitation cancelled.");
}

export async function changeRole(formData: FormData) {
  const { supabase } = await requireSession(["admin"]);
  const role = text(formData, "role");
  if (!["admin", "agent", "coach"].includes(role)) back("error", "Choose a role.");
  const { error } = await supabase.from("memberships").update({ role }).eq("id", text(formData, "id"));
  if (error) back("error", friendlyError(error));
  revalidatePath("/team");
  back("notice", "Role updated.");
}

export async function removeMember(formData: FormData) {
  const { supabase, membership } = await requireSession(["admin"]);
  const id = text(formData, "id");
  if (id === membership.id) back("error", "You can't remove yourself. Ask another admin to do it.");
  const { error } = await supabase.from("memberships").delete().eq("id", id);
  if (error) back("error", friendlyError(error));
  revalidatePath("/team");
  back("notice", "Removed from the team. Their past work stays in the history.");
}

export async function updateMyProfile(formData: FormData) {
  const { supabase, membership } = await requireSession();
  const fullName = text(formData, "full_name").slice(0, 120);
  const returnTo = text(formData, "return_to") === "/account" ? "/account" : "/team";
  const { error } = await supabase.from("memberships").update({ full_name: fullName }).eq("id", membership.id);
  if (error) redirect(`${returnTo}?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/", "layout");
  redirect(`${returnTo}?notice=${encodeURIComponent("Your name was updated.")}`);
}
