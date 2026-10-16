import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/admin";
import { buildIcs } from "@/lib/ics";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAnonClient();
  const { data } = await supabase.rpc("get_response_page", { p_token: token });
  const page = data as {
    found: boolean;
    reference?: string;
    status?: string;
    starts_at?: string;
    ends_at?: string;
    coach?: string;
    venue?: string;
    venue_address?: string | null;
    court?: string | null;
    org_name?: string;
    session_type?: string | null;
  } | null;
  if (!page?.found || !page.starts_at || !page.ends_at) {
    return NextResponse.json({ error: "Link not found." }, { status: 404 });
  }
  const ics = buildIcs({
    uid: `${page.reference}-${page.starts_at}`,
    start: page.starts_at,
    end: page.ends_at,
    title: `Tennis with Coach ${page.coach ?? ""}`.trim(),
    location: [page.venue, page.court, page.venue_address].filter(Boolean).join(", "),
    description: `${page.session_type ?? "Tennis session"} · ${page.org_name ?? ""} · Ref ${page.reference ?? ""}`,
    cancelled: page.status === "cancelled"
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="tennis-${page.reference ?? "session"}.ics"`,
      "Cache-Control": "no-store"
    }
  });
}
