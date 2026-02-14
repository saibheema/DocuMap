export type ClientExtractedField = {
  id?: string;
  label: string;
  value: string;
  confidence?: number;
};

export type ClientExtractionResult = {
  fields: ClientExtractedField[];
  method: "pdf-text" | "ocr" | "none";
};

function sanitizeLabel(label: string) {
  return label.replace(/\s+/g, " ").replace(/[:\-]+$/, "").trim();
}

function sanitizeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeAmount(value: string) {
  return /\(?-?\d[\d,]*(?:\.\d+)?\)?%?/.test(value);
}

function extractFromLine(line: string): { label: string; value: string; confidence: number } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 3) return null;

  const colonMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_\s\-/().&]{1,80})\s*:\s*(.+)$/);
  if (colonMatch) {
    return {
      label: sanitizeLabel(colonMatch[1]),
      value: sanitizeValue(colonMatch[2]),
      confidence: 0.9
    };
  }

  const trailingNumberMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&]{2,80})\s+([₹$€£]?\(?-?\d[\d,]*(?:\.\d+)?\)?%?)$/
  );
  if (trailingNumberMatch && looksLikeAmount(trailingNumberMatch[2])) {
    return {
      label: sanitizeLabel(trailingNumberMatch[1]),
      value: sanitizeValue(trailingNumberMatch[2]),
      confidence: 0.82
    };
  }

  const wideGapMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_\s\-/().&]{1,80}?)\s{2,}(.+)$/);
  if (wideGapMatch) {
    return {
      label: sanitizeLabel(wideGapMatch[1]),
      value: sanitizeValue(wideGapMatch[2]),
      confidence: 0.75
    };
  }

  return null;
}

function extractFieldsFromText(text: string): ClientExtractedField[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const fields: ClientExtractedField[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const candidate = extractFromLine(line);
    if (!candidate) continue;

    const key = `${candidate.label.toLowerCase()}::${candidate.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    fields.push({
      id: `ef_${fields.length + 1}`,
      label: candidate.label,
      value: candidate.value,
      confidence: candidate.confidence
    });
  }

  return fields;
}

function buildTextByLine(items: Array<{ str?: string; transform?: number[] }>): string {
  const rows = items
    .map((item) => ({
      text: (item.str || "").trim(),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0
    }))
    .filter((x) => x.text.length > 0)
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
      return a.x - b.x;
    });

  const lines: string[] = [];
  let currentY: number | null = null;
  let buffer: string[] = [];

  for (const row of rows) {
    if (currentY === null || Math.abs(row.y - currentY) <= 2) {
      currentY = currentY ?? row.y;
      buffer.push(row.text);
      continue;
    }

    lines.push(buffer.join(" "));
    buffer = [row.text];
    currentY = row.y;
  }

  if (buffer.length) {
    lines.push(buffer.join(" "));
  }

  return lines.join("\n");
}

async function extractPdfText(file: File, maxPages = 4): Promise<{ text: string; pages: unknown[] }> {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
  const doc = await loadingTask.promise;

  const pageCount = Math.min(doc.numPages, maxPages);
  let text = "";
  const pages: unknown[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    pages.push(page);
    const textContent = await page.getTextContent();
    const lineText = buildTextByLine(textContent.items as Array<{ str?: string; transform?: number[] }>);
    text += `\n${lineText}`;
  }

  return { text, pages };
}

async function ocrPdfPages(pages: unknown[], maxPages = 2): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const targetPages = pages.slice(0, maxPages) as Array<{
    getViewport: (p: { scale: number }) => { width: number; height: number };
    render: (p: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
      promise: Promise<void>;
    };
  }>;

  let fullText = "";

  for (const page of targetPages) {
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext("2d");
    if (!context) {
      continue;
    }

    await page.render({ canvasContext: context, viewport }).promise;
    const result = await recognize(canvas, "eng", {});
    if (result?.data?.text) {
      fullText += `\n${result.data.text}`;
    }
  }

  return fullText;
}

export async function extractFieldsFromPdfInBrowser(file: File): Promise<ClientExtractionResult> {
  const { text, pages } = await extractPdfText(file);
  let fields = extractFieldsFromText(text);

  if (fields.length > 0) {
    return { fields, method: "pdf-text" };
  }

  const ocrText = await ocrPdfPages(pages, 2);
  fields = extractFieldsFromText(ocrText);

  if (fields.length > 0) {
    return { fields, method: "ocr" };
  }

  return { fields: [], method: "none" };
}
