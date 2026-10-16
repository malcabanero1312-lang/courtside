"use server";

import { after } from "next/server";
import { createAnonClient } from "@/lib/supabase/admin";
import { processNotificationsSoon } from "@/lib/notifications";
import { logError } from "@/lib/errors";

export interface ResponseState {
  ok?: boolean;
  status?: string;
  error?: string;
}

export async function submitResponse(_prev: ResponseState, formData: FormData): Promise<ResponseState> {
  const token = String(formData.get("token") ?? "");
  const action = String(formData.get("choice") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 600);
  if (!["confirm", "decline", "reschedule"].includes(action)) {
    return { error: "Please choose one of the options." };
  }
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("submit_student_response", {
    p_token: token,
    p_action: action,
    p_note: note
  });
  if (error) {
    logError("portal", error);
    return { error: "We couldn't save your answer. Please try again in a moment." };
  }
  const result = data as { ok: boolean; status?: string; error?: string };
  if (!result.ok) {
    return { error: result.error ?? "We couldn't save your answer." };
  }
  after(processNotificationsSoon);
  return { ok: true, status: result.status };
}
