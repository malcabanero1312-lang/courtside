import type { SheetTextItem } from "@/lib/court-sheet";

// pdf.js is served from /public so it never goes through the bundler or the server.
const PDFJS_BASE = "/pdfjs/6.2.108";

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { height: number };
        getTextContent: () => Promise<{ items: unknown[] }>;
        cleanup: () => void;
      }>;
    }>;
    destroy: () => Promise<void>;
  };
}

let loader: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!loader) {
    const url = `${PDFJS_BASE}/pdf.min.mjs`;
    loader = (import(/* webpackIgnore: true */ url) as Promise<PdfJs>).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    });
    loader.catch(() => {
      loader = null;
    });
  }
  return loader;
}

export async function readPdfTextInBrowser(file: File): Promise<SheetTextItem[]> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const items: SheetTextItem[] = [];
  try {
    const doc = await task.promise;
    for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const raw of content.items as PdfTextItem[]) {
        if (!raw.str || !raw.str.trim() || !raw.transform) continue;
        items.push({ str: raw.str, x: raw.transform[4], y: viewport.height - raw.transform[5], width: raw.width ?? 0, page: p });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return items;
}
