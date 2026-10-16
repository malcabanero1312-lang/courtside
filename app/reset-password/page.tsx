import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/buttons";
import { Flash } from "@/components/ui";

async function updatePassword(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) {
    redirect("/reset-password?error=" + encodeURIComponent("Use at least 8 characters."));
  }
  if (password !== confirm) {
    redirect("/reset-password?error=" + encodeURIComponent("The two passwords don't match."));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/reset-password?error=" + encodeURIComponent("Couldn't update the password. Request a new reset link and try again."));
  }
  redirect("/dashboard?notice=" + encodeURIComponent("Your password has been updated."));
}

export default async function PasswordPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="portal">
      <div className="portal-card">
        <div className="card card-pad stack">
          <h1 className="display" style={{ fontSize: 28 }}>Choose a new password</h1>
          <Flash params={params} />
          <form action={updatePassword} className="stack">
            <label className="field">
              <span>New password</span>
              <input className="input" type="password" name="password" minLength={8} required autoComplete="new-password" />
            </label>
            <label className="field">
              <span>Repeat new password</span>
              <input className="input" type="password" name="confirm" minLength={8} required autoComplete="new-password" />
            </label>
            <SubmitButton variant="primary" block>Save password</SubmitButton>
          </form>
        </div>
      </div>
    </main>
  );
}
