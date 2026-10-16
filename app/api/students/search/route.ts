import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.org || !session.membership || session.membership.role === "coach") {
    return NextResponse.json({ students: [] }, { status: 401 });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  let query = session.supabase
    .from("students")
    .select("id, full_name, phone, email, guardian_name")
    .eq("org_id", session.org.id)
    .eq("is_archived", false)
    .order("full_name")
    .limit(8);
  if (q) {
    const safe = q.replace(/[%,()*\\]/g, " ").trim();
    const digits = q.replace(/\D/g, "");
    const filters = [`full_name.ilike.%${safe}%`, `email.ilike.%${safe}%`, `guardian_name.ilike.%${safe}%`];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits.replace(/^0+/, "")}%`);
    query = query.or(filters.join(","));
  }
  const { data } = await query;
  return NextResponse.json({ students: data ?? [] });
}
