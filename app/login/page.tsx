import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { getSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/env";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const params = await searchParams;
  const session = await getSession();
  if (session?.membership) redirect("/dashboard");
  if (session) redirect("/onboarding");

  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="auth-page">
      <section className="auth-art">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="ball" size={20} />
          </div>
          <div className="brand-name">Courtside</div>
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1>Every session booked, confirmed and on court.</h1>
          <p style={{ color: "#b9d1c5", marginTop: 16, maxWidth: 420 }}>
            Scheduling without double bookings, one-tap WhatsApp messages, and students who confirm in a single click.
          </p>
        </div>
        <p className="small" style={{ color: "#7fa594", position: "relative", zIndex: 1 }}>
          Built for coaches, agents and clubs.
        </p>
      </section>
      <section className="auth-form">
        <LoginForm next={next} initialError={error} />
      </section>
    </main>
  );
}
