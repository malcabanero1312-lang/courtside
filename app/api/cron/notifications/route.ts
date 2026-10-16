import { NextResponse, type NextRequest } from "next/server";
import { runNotificationWorker } from "@/lib/notifications";
import { cronSecret } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const secret = cronSecret();
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : request.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runNotificationWorker({ limit: 50 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
