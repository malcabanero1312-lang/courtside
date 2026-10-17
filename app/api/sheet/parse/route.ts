import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { parseCourtSheet, type SheetTextItem } from "@/lib/court-sheet";
import { logError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

async function extractItems(data: Uint8Array): Promise<SheetTextItem[]> {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data, useSystemFonts: true, disableFontFace: true });
  const doc = await task.promise;
  const items: SheetTextItem[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const raw of content.items as unknown as PdfTextItem[]) {
        if (!raw.str || !raw.str.trim() || !raw.transform) continue;
        items.push({
          str: raw.str,
          x: raw.transform[4],
          y: viewport.height - raw.transform[5],
          width: raw.width ?? 0,
          page: p
        });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return items;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.membership || session.membership.role === "coach") {
    return NextResponse.json({ error: "Only admins and agents can import sheets." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Choose the office's PDF sheet first." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than 15 MB. Please export a smaller PDF." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return NextResponse.json(
      { error: "That isn't a PDF. Download the sheet from SharePoint as PDF (or Print → Save as PDF) and try again." },
      { status: 400 }
    );
  }

  try {
    const items = await extractItems(bytes);
    if (items.length === 0) {
      return NextResponse.json(
        { error: "This PDF has no readable text (it may be a scanned picture). Ask the office for the PDF exported from Excel." },
        { status: 422 }
      );
    }
    const parsed = parseCourtSheet(items);
    if (parsed.sessions.length === 0) {
      return NextResponse.json(
        { error: "We couldn't find any coach bookings in this file. Check it's the monthly court bookings sheet." },
        { status: 422 }
      );
    }
    return NextResponse.json({ sessions: parsed.sessions, coaches: parsed.coaches, notes: parsed.notes, days: parsed.days });
  } catch (error) {
    logError("sheet-parse", error);
    return NextResponse.json({ error: "We couldn't read this PDF. Please try again or send it to your admin." }, { status: 500 });
  }
}
