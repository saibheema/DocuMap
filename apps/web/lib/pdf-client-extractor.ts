import { extractFieldsWithGemini, getGeminiApiKey } from "./ai-extractor";

export type ClientExtractedField = {
  id?: string;
  label: string;
  value: string;
  confidence?: number;
};

export type ClientExtractionResult = {
  fields: ClientExtractedField[];
  method: "ai" | "pdf-text" | "ocr" | "none";
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function sanitizeLabel(label: string) {
  return label.replace(/\s+/g, " ").replace(/[:\-]+$/, "").trim();
}

function sanitizeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeAmount(value: string) {
  // Handles standard (1,234,567.89) and Indian (12,34,567.89) number formats
  return /\(?-?[₹$€£¥]?\s?\d[\d,]*(?:\.\d+)?\s?%?\)?/.test(value);
}

/* ------------------------------------------------------------------ */
/*  Text quality check — detects garbled font-encoded text            */
/* ------------------------------------------------------------------ */

/**
 * Detects when extracted text is just a watermark / scanner branding
 * repeated on every page (e.g. "AnyScanner\nAnyScanner\n...").
 */
function isWatermarkOnly(text: string): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;

  // Count unique lines — watermarks are just 1-2 unique phrases repeated
  const unique = new Set(lines.map(l => l.toLowerCase()));
  if (unique.size <= 3 && lines.length >= 3) {
    // Check that the unique lines are short branding-style words
    const avgUniqueLen = [...unique].reduce((s, l) => s + l.length, 0) / unique.size;
    if (avgUniqueLen < 40) return true;
  }

  return false;
}

/**
 * Returns true when the supplied text looks like genuine human-readable
 * content.  Returns false when it's garbled (e.g. custom font encoding
 * produces random ASCII fragments like "JgV", "yO(", "t3t", etc.).
 *
 * @param strict  When true (default) requires 30% real words.
 *                When false (used for OCR) only requires 15%.
 */
function isTextMeaningful(text: string, strict = true): boolean {
  if (!text || text.trim().length < 10) return false;

  // Split into word-like tokens
  const tokens = text.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;

  // A "real" word contains mostly letters/digits and is ≥ 3 chars
  const realWords = tokens.filter((t) => {
    const alphaNum = t.replace(/[^A-Za-z0-9]/g, "");
    return alphaNum.length >= 3 && /[A-Za-z]/.test(t);
  });

  const realRatio = realWords.length / tokens.length;

  // Average word length — garbage usually has very short tokens
  const avgLen =
    realWords.reduce((sum, w) => sum + w.length, 0) / (realWords.length || 1);

  const minRatio = strict ? 0.3 : 0.1;
  const minAvgLen = strict ? 3 : 2;

  return realRatio >= minRatio && avgLen >= minAvgLen;
}

/* ------------------------------------------------------------------ */
/*  Line-based field extraction from plain text                       */
/* ------------------------------------------------------------------ */

function extractFromLine(
  line: string
): { label: string; value: string; confidence: number } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 3) return null;

  // "Label: Value" — allow labels with special chars common in financial docs
  const colonMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&'",%#@]{1,120})\s*:\s*(.+)$/
  );
  if (colonMatch) {
    return {
      label: sanitizeLabel(colonMatch[1]),
      value: sanitizeValue(colonMatch[2]),
      confidence: 0.9,
    };
  }

  // "Label   123.45" or "Label   ₹12,34,567.00" (Indian/intl formats)
  const trailingNumberMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&'",%#@]{2,120})\s+([₹$€£¥]?\s?\(?-?\d[\d,]*(?:\.\d+)?\)?\s?%?)$/
  );
  if (trailingNumberMatch && looksLikeAmount(trailingNumberMatch[2])) {
    return {
      label: sanitizeLabel(trailingNumberMatch[1]),
      value: sanitizeValue(trailingNumberMatch[2]),
      confidence: 0.82,
    };
  }

  // "Label      Value" (wide gap — 2+ spaces between label and value)
  const wideGapMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&'",%#@]{1,120}?)\s{2,}(.+)$/
  );
  if (wideGapMatch) {
    return {
      label: sanitizeLabel(wideGapMatch[1]),
      value: sanitizeValue(wideGapMatch[2]),
      confidence: 0.75,
    };
  }

  // "Key = Value" or "Key | Value" (alternate separators)
  const altSepMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&'",%#@]{1,120})\s*[=|]\s*(.+)$/
  );
  if (altSepMatch) {
    return {
      label: sanitizeLabel(altSepMatch[1]),
      value: sanitizeValue(altSepMatch[2]),
      confidence: 0.78,
    };
  }

  return null;
}

function extractFieldsFromText(
  text: string,
  forceRawFallback = false
): ClientExtractedField[] {
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
      confidence: candidate.confidence,
    });
  }

  // Fallback: use whole lines if no structured fields found
  if (fields.length === 0 && lines.length > 0) {
    // For OCR or when forced, always provide raw lines so user sees something
    const minLineLen = forceRawFallback ? 2 : 4;
    const maxLines = forceRawFallback ? 100 : 60;
    const fallbackLines = lines
      .filter((line) => line.length >= minLineLen)
      .slice(0, maxLines);
    for (const line of fallbackLines) {
      const value = sanitizeValue(line);
      if (!value) continue;
      const key = `line::${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      fields.push({
        id: `ef_${fields.length + 1}`,
        label: `Line ${fields.length + 1}`,
        value,
        confidence: 0.35,
      });
    }
  }

  return fields;
}

/* ------------------------------------------------------------------ */
/*  pdf.js text extraction (lightweight, no OCR)                      */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfPage = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildTextByLine(
  items: Array<{ str?: string; transform?: number[] }>
): string {
  const rows = items
    .map((item) => ({
      text: (item.str || "").trim(),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
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
  if (buffer.length) lines.push(buffer.join(" "));

  return lines.join("\n");
}

async function extractPdfText(
  file: File,
  maxPages = 50
): Promise<{ text: string; pages: PdfPage[] }> {
  try {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
    const doc = await loadingTask.promise;

    const pageCount = Math.min(doc.numPages, maxPages);
    let text = "";
    const pages: PdfPage[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      pages.push(page);
      const textContent = await page.getTextContent();
      const lineText = buildTextByLine(
        textContent.items as Array<{ str?: string; transform?: number[] }>
      );
      text += `\n${lineText}`;
    }

    console.log(
      "[DocuMap] pdf.js extracted",
      text.length,
      "chars from",
      pageCount,
      "pages"
    );
    return { text, pages };
  } catch (err) {
    console.error("[DocuMap] pdf.js extraction error:", err);
    return { text: "", pages: [] };
  }
}

/* ------------------------------------------------------------------ */
/*  Render a pdf.js page to a high-res PNG data-URL                   */
/* ------------------------------------------------------------------ */

async function renderPageToDataUrl(
  page: PdfPage,
  scale = 2
): Promise<string | null> {
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Return a PNG data-URL which Tesseract can consume directly
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("[DocuMap] page render error:", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Tesseract.js OCR                                                  */
/* ------------------------------------------------------------------ */

async function ocrPdfPages(
  pages: PdfPage[],
  maxPages = 15,
  onProgress?: (msg: string) => void
): Promise<string> {
  // Dynamic import so the bundle only loads when actually needed
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const Tess: any = await import("tesseract.js");
  const createWorker: any = Tess.createWorker ?? Tess.default?.createWorker;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!createWorker) {
    console.error("[DocuMap] tesseract.js createWorker not found in module");
    return "";
  }

  console.log("[DocuMap] initialising Tesseract worker …");
  const worker = await createWorker("eng");
  console.log("[DocuMap] Tesseract worker ready");

  const targetPages = pages.slice(0, maxPages);
  let fullText = "";

  for (let i = 0; i < targetPages.length; i++) {
    onProgress?.(`OCR processing page ${i + 1} of ${targetPages.length}…`);

    // Render at 2× first (good balance of quality vs memory)
    const dataUrl = await renderPageToDataUrl(targetPages[i], 2);
    if (!dataUrl) {
      console.warn(`[DocuMap] failed to render page ${i + 1} to canvas`);
      continue;
    }

    console.log(
      `[DocuMap] page ${i + 1} rendered, dataUrl length = ${dataUrl.length}`
    );

    try {
      const result = await worker.recognize(dataUrl);
      const pageText = result?.data?.text ?? "";
      console.log(
        `[DocuMap] page ${i + 1} OCR returned ${pageText.length} chars`
      );
      if (pageText.trim()) {
        fullText += `\n${pageText}`;
      }
    } catch (recErr) {
      console.error(`[DocuMap] OCR recognize error on page ${i + 1}:`, recErr);
    }
  }

  // If 2× didn't produce much text, retry page 1 at 3× as a sanity check
  if (fullText.trim().length < 50 && targetPages.length > 0) {
    console.log("[DocuMap] retrying page 1 at 3× scale …");
    const hiResUrl = await renderPageToDataUrl(targetPages[0], 3);
    if (hiResUrl) {
      try {
        const result = await worker.recognize(hiResUrl);
        const retry = result?.data?.text ?? "";
        console.log(`[DocuMap] 3× retry returned ${retry.length} chars`);
        if (retry.trim().length > fullText.trim().length) {
          fullText = retry;
        }
      } catch (retryErr) {
        console.error("[DocuMap] 3× retry error:", retryErr);
      }
    }
  }

  await worker.terminate();
  return fullText;
}

/* ------------------------------------------------------------------ */
/*  Main extraction pipeline                                          */
/* ------------------------------------------------------------------ */

export async function extractFieldsFromPdfInBrowser(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ClientExtractionResult> {
  try {
    // ─── 1. Quick pdf.js check to see if it's a text-native PDF ───
    onProgress?.("Analyzing PDF…");
    const { text, pages } = await extractPdfText(file);

    // Detect scanned / image-only PDFs (watermark-only text like "AnyScanner")
    const scannedDoc = !text.trim() || text.trim().length < 20 || isWatermarkOnly(text);

    if (scannedDoc) {
      console.log("[DocuMap] Detected scanned/image-only PDF (text:", JSON.stringify(text.trim().slice(0, 80)), ")");
    }

    // If we get good text from pdf.js (not a scanned doc), try extraction immediately
    if (!scannedDoc && text.trim().length > 10) {
      const fields = extractFieldsFromText(text);
      
      // If we found structured key-value fields (not just raw lines), return them
      if (fields.length > 0 && fields.some(f => (f.confidence ?? 0) >= 0.7)) {
        console.log("[DocuMap] pdf.js extracted", fields.length, "structured fields");
        return { fields, method: "pdf-text" };
      }
    }

    // ─── 2. Gemini AI extraction (best for OCR, scanned docs, and complex layouts) ───
    if (getGeminiApiKey()) {
      onProgress?.(scannedDoc
        ? "Scanned PDF detected — sending to Gemini AI for OCR extraction…"
        : "Using Gemini Flash 2.5 for extraction…");
      try {
        const aiFields = await extractFieldsWithGemini(file, onProgress);
        if (aiFields && aiFields.length > 0) {
          console.log("[DocuMap] Gemini extracted", aiFields.length, "fields");
          return { fields: aiFields, method: "ai" };
        }
        console.log("[DocuMap] Gemini returned no fields, trying fallback");
      } catch (err) {
        console.warn("[DocuMap] Gemini extraction failed:", err);
      }
    } else if (scannedDoc) {
      // For scanned docs without Gemini, give a clear warning before attempting OCR
      onProgress?.("⚠️ Scanned PDF detected. Gemini API key recommended for best results. Trying OCR…");
    }

    // ─── 3. Tesseract.js OCR (open-source fallback when no API key) ───
    if (pages.length > 0) {
      // For large scanned docs, limit OCR to fewer pages to avoid browser timeout
      const ocrPageLimit = scannedDoc && pages.length > 10 ? 8 : 15;
      onProgress?.(`Running OCR on ${Math.min(pages.length, ocrPageLimit)} pages — this may take a moment…`);
      try {
        const ocrText = await ocrPdfPages(pages, ocrPageLimit, onProgress);
        console.log(
          "[DocuMap] OCR total text length:",
          ocrText.trim().length
        );

        if (ocrText.trim().length > 0) {
          // Use lenient quality check for OCR output
          const meaningful = isTextMeaningful(ocrText, false);
          console.log("[DocuMap] OCR text meaningful (lenient):", meaningful);

          // Even if the text isn't "meaningful" by our check, try to extract
          // fields — the regexes will filter out actual garbage
          const fields = extractFieldsFromText(ocrText, true);

          if (fields.length > 0) {
            return { fields, method: "ocr" };
          }
        }
      } catch (ocrErr) {
        console.error("[DocuMap] OCR pipeline error:", ocrErr);
      }
    }

    // ─── 4. Last resort: return raw pdf.js text even if garbled ───
    if (!scannedDoc && text.trim().length > 10) {
      onProgress?.("Using raw PDF text as fallback…");
      const fields = extractFieldsFromText(text, true);
      if (fields.length > 0) {
        console.log("[DocuMap] returning", fields.length, "raw text fields");
        return { fields, method: "pdf-text" };
      }
    }

    // Absolute last resort: create at least one field with any available text
    const anyText = text.trim();
    if (anyText.length > 0 && !scannedDoc) {
      onProgress?.("Extraction complete — raw text only");
      const lines = anyText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      
      if (lines.length > 0) {
        const fallbackFields = lines.slice(0, 100).map((line, idx) => ({
          id: `ef_${idx + 1}`,
          label: `Content Line ${idx + 1}`,
          value: line.slice(0, 500),
          confidence: 0.2
        }));
        console.log("[DocuMap] returning", fallbackFields.length, "fallback content lines");
        return { fields: fallbackFields, method: "pdf-text" };
      }
    }

    // If pdf.js failed, try one more time with just the file name
    onProgress?.(scannedDoc && !getGeminiApiKey()
      ? "⚠️ This is a scanned PDF. Configure a Gemini API key for accurate extraction."
      : "Creating placeholder extraction…");
    console.warn("[DocuMap] all text extraction failed - creating placeholder");
    return {
      fields: [
        {
          id: "ef_1",
          label: "Document Name",
          value: file.name,
          confidence: 0.1
        },
        {
          id: "ef_2",
          label: "Note",
          value: scannedDoc
            ? "This is a scanned/image-only PDF. Please configure a Gemini API key (free from Google AI Studio) for accurate AI-powered OCR extraction."
            : "No text could be extracted from this PDF. It may be encrypted. Configure a Gemini API key for better results.",
          confidence: 0.1
        }
      ],
      method: "none"
    };
  } catch (err) {
    console.error("[DocuMap] extraction pipeline error:", err);
    return { fields: [], method: "none" };
  }
}
