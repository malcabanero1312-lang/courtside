"use server";

import { createAnonClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/errors";

export interface MonthlyResponseState {
  ok?: boolean;
  status?: string;
  error?: string;
  confirmed?: number;
  requested?: number;
}

export async function submitMonthlyResponse(_prev: MonthlyResponseState, formData: FormData): Promise<MonthlyResponseState> {
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 600);
  if (!["confirm", "change", "decline"].includes(choice)) return { error: "Please choose one of the options." };
  const dates = formData
    .getAll("dates")
    .map(String)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .slice(0, 62);
  if (choice === "confirm" && formData.get("has_dates") === "1" && dates.length === 0) {
    return { error: "Tick at least one date, or choose “I'm not continuing this month”." };
  }
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("respond_monthly", {
    p_token: token,
    p_action: choice,
    p_note: note,
    p_dates: choice === "confirm" && formData.get("has_dates") === "1" ? dates : null
  });
  if (error) {
    logError("monthly-portal", error);
    return { error: "We couldn't save your answer. Please try again in a moment." };
  }
  const result = data as { ok: boolean; status?: string; error?: string; confirmed?: number; requested?: number };
  if (!result.ok) return { error: result.error ?? "We couldn't save your answer.", status: result.status };
  return { ok: true, status: result.status, confirmed: result.confirmed, requested: result.requested };
}
