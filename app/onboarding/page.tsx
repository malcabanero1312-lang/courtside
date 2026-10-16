import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, ORG_COOKIE } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { TIMEZONES } from "@/lib/format";
import { SubmitButton } from "@/components/buttons";
import { Flash } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Get started" };

async function createOrganization(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "Asia/Manila");
  const country = String(formData.get("country_code") ?? "63").replace(/\D/g, "") || "63";
  if (name.length < 2) {
    redirect("/onboarding?error=" + encodeURIComponent("Enter your club or academy name."));
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: name,
    p_timezone: timezone,
    p_full_name: fullName,
    p_country_code: country
  });
  if (error || !data) {
    redirect("/onboarding?error=" + encodeURIComponent(friendlyError(error)));
  }
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, String(data), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard?notice=" + encodeURIComponent("Your workspace is ready. Follow the checklist to finish setting up."));
}

async function checkInvitations() {
  "use server";
  const supabase = await createClient();
  const { data } = await supabase.rpc("accept_invitations");
  if (data && Number(data) > 0) {
    redirect("/dashboard?notice=" + encodeURIComponent("Invitation accepted. Welcome aboard!"));
  }
  redirect(
    "/onboarding?error=" +
      encodeURIComponent("No invitation found for your email yet. Ask your admin to invite the exact email you signed up with.")
  );
}

export default async function OnboardingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.membership) redirect("/dashboard");

  const defaultName = String(session.user.user_metadata?.full_name ?? "");

  return (
    <main className="portal">
      <div className="portal-card" style={{ maxWidth: 560 }}>
        <div className="row" style={{ marginBottom: 18 }}>
          <div className="brand-mark">
            <Icon name="ball" size={20} />
          </div>
          <div className="display" style={{ fontSize: 22 }}>Courtside</div>
        </div>
        <Flash params={params} />
        <div className="card">
          <div className="card-body stack">
            <div>
              <div className="eyebrow">Step 1 of 1</div>
              <h1 className="display" style={{ fontSize: 28 }}>Set up your workspace</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                You'll be the admin. You can invite coaches and agents right after this.
              </p>
            </div>
            <form action={createOrganization} className="stack">
              <label className="field">
                <span>Club or academy name</span>
                <input className="input" name="name" required minLength={2} placeholder="Baseline Tennis Academy" />
              </label>
              <label className="field">
                <span>Your name</span>
                <input className="input" name="full_name" defaultValue={defaultName} placeholder="Ana Reyes" />
                <small>Shown in WhatsApp messages you send, e.g. “This is Ana from …”.</small>
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>Time zone</span>
                  <select className="input" name="timezone" defaultValue="Asia/Manila">
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Phone country code</span>
                  <input className="input" name="country_code" defaultValue="63" inputMode="numeric" maxLength={4} />
                  <small>Used to turn local numbers like 0917… into WhatsApp numbers.</small>
                </label>
              </div>
              <SubmitButton variant="primary" size="lg" block pendingText="Creating workspace…">
                Create workspace
              </SubmitButton>
            </form>
          </div>
          <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="row between wrap">
              <div>
                <div style={{ fontWeight: 600 }}>Were you invited by a club?</div>
                <div className="small muted">Signed in as {session.user.email}</div>
              </div>
              <form action={checkInvitations}>
                <SubmitButton size="small">Check my invitations</SubmitButton>
              </form>
            </div>
          </div>
        </div>
        <form action="/auth/signout" method="post" style={{ marginTop: 14, textAlign: "center" }}>
          <button className="btn ghost small" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
