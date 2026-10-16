export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? ""
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

export function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
}

export function appUrl(): string {
  const fromEnv = publicEnv.appUrl || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return (fromEnv || "http://localhost:3000").replace(/\/+$/, "");
}

export function emailSettings() {
  return {
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? ""
  };
}

export function isEmailConfigured(): boolean {
  const settings = emailSettings();
  return Boolean(settings.apiKey && settings.from);
}

export function cronSecret(): string {
  return process.env.CRON_SECRET ?? "";
}
