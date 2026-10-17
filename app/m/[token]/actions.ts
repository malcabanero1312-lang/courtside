"use server";

import { createAnonClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/errors";

export interface MonthlyResponseState {
  ok?: boolean;
  status?: string;
  error?: string;
}

export async function submitMonthlyResponse(_prev: MonthlyResponseState, formData: FormData): Promise<MonthlyResponseState> {
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 600);
  if (!["confirm", "change", "decline"].includes(choice)) return { error: "Please choose one of the options." };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("respond_monthly", { p_token: token, p_action: choice, p_note: note });
  if (error) {
    logError("monthly-portal", error);
    return { error: "We couldn't save your answer. Please try again in a moment." };
  }
  const result = data as { ok: boolean; status?: string; error?: string };
  if (!result.ok) return { error: result.error ?? "We couldn't save your answer.", status: result.status };
  return { ok: true, status: result.status };
}
