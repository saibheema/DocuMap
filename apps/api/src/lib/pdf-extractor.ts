import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import pdf from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { OUTPUT_FIELDS, SYNONYM_MAP, type OutputFieldKey } from "@documap/shared";

const execFile = promisify(execFileCb);

export type ExtractedField = {
  id: string;
  label: string;
  value: string;
  confidence: number;
};

function normalizeSourcePath(sourcePath: string) {
  if (sourcePath.startsWith("file://")) {
    return sourcePath.replace("file://", "");
  }

  if (sourcePath.startsWith("local-upload://")) {
    throw new Error("local-upload:// paths are placeholders and cannot be read by server");
  }

  return sourcePath;
}

function looksLikeAmount(value: string) {
  // Handles standard (1,234,567.89) and Indian (12,34,567.89) number formats
  return /\(?-?[₹$€£¥]?\s?\d[\d,]*(?:\.\d+)?\s?%?\)?/.test(value);
}

function sanitizeLabel(label: string) {
  return label.replace(/\s+/g, " ").replace(/[:\-]+$/, "").trim();
}

function sanitizeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Detects when extracted text is just a watermark/scanner branding
 * repeated on every page (e.g. "AnyScanner\nAnyScanner\n...").
 */
function isWatermarkOnly(text: string): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  const unique = new Set(lines.map(l => l.toLowerCase()));
  if (unique.size <= 3 && lines.length >= 3) {
    const avgUniqueLen = [...unique].reduce((s, l) => s + l.length, 0) / unique.size;
    if (avgUniqueLen < 40) return true;
  }
  return false;
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFile("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function extractTextWithOcr(pdfPath: string): Promise<string> {
  const hasPdftoppm = await isCommandAvailable("pdftoppm");
  const hasTesseract = await isCommandAvailable("tesseract");
  if (!hasPdftoppm || !hasTesseract) {
    return "";
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "documap-ocr-"));
  try {
    const outputPrefix = path.join(tmpDir, "page");
    await execFile("pdftoppm", [
      "-f",
      "1",
      "-l",
      "10",
      "-png",
      "-r",
      "150",
      pdfPath,
      outputPrefix
    ], { maxBuffer: 50 * 1024 * 1024 });

    const files = await fs.readdir(tmpDir);
    const pageImages = files
      .filter((f) => /^page-\d+\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    let text = "";
    for (const imageName of pageImages) {
      const imagePath = path.join(tmpDir, imageName);
      const { stdout } = await execFile("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", "6"], { maxBuffer: 10 * 1024 * 1024 });
      if (stdout) {
        text += `\n${stdout}`;
      }
    }

    return text.trim();
  } catch {
    return "";
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function isLikelyLabel(line: string) {
  const t = line.trim();
  if (!t || t.length < 2 || t.length > 150) {
    return false;
  }
  if (/^[\d\W]+$/.test(t)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9_\s\-/().&:#'",% ]*$/.test(t);
}

function isLikelyValue(line: string) {
  const t = line.trim();
  if (!t || t.length < 1 || t.length > 300) {
    return false;
  }

  if (looksLikeAmount(t)) {
    return true;
  }

  if (/^[A-Za-z0-9₹$€£¥][A-Za-z0-9_\-/().,:#'"\s]{1,300}$/.test(t)) {
    return true;
  }

  return false;
}

function extractFromLine(line: string): { label: string; value: string; confidence: number } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 3) {
    return null;
  }

  const colonMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_\s\-/().&'",% #@]{1,120})\s*:\s*(.+)$/);
  if (colonMatch) {
    return {
      label: sanitizeLabel(colonMatch[1]),
      value: sanitizeValue(colonMatch[2]),
      confidence: 0.9
    };
  }

  const trailingNumberMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&'",% #@]{2,120})\s+([₹$€£¥]?\s?\(?-?\d[\d,]*(?:\.\d+)?\)?\s?%?)$/
  );
  if (trailingNumberMatch && looksLikeAmount(trailingNumberMatch[2])) {
    return {
      label: sanitizeLabel(trailingNumberMatch[1]),
      value: sanitizeValue(trailingNumberMatch[2]),
      confidence: 0.82
    };
  }

  const wideGapMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_\s\-/().&'",% #@]{1,120}?)\s{2,}(.+)$/);
  if (wideGapMatch && isLikelyValue(wideGapMatch[2])) {
    return {
      label: sanitizeLabel(wideGapMatch[1]),
      value: sanitizeValue(wideGapMatch[2]),
      confidence: 0.78
    };
  }

  // "Key = Value" or "Key | Value" (alternate separators)
  const altSepMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_\s\-/().&'",% #@]{1,120})\s*[=|]\s*(.+)$/
  );
  if (altSepMatch) {
    return {
      label: sanitizeLabel(altSepMatch[1]),
      value: sanitizeValue(altSepMatch[2]),
      confidence: 0.78
    };
  }

  return null;
}

function extractFieldsFromText(text: string): ExtractedField[] {
  const lines = text
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean);

  const extracted: ExtractedField[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const candidate = extractFromLine(line);
    if (!candidate) {
      continue;
    }

    const dedupeKey = `${candidate.label.toLowerCase()}::${candidate.value.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    extracted.push({
      id: `ef_${extracted.length + 1}`,
      label: candidate.label,
      value: candidate.value,
      confidence: candidate.confidence
    });
  }

  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];

    if (!isLikelyLabel(current) || !isLikelyValue(next)) {
      continue;
    }

    if (next.includes(":")) {
      continue;
    }

    const label = sanitizeLabel(current);
    const value = sanitizeValue(next);
    const dedupeKey = `${label.toLowerCase()}::${value.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    extracted.push({
      id: `ef_${extracted.length + 1}`,
      label,
      value,
      confidence: 0.72
    });
  }

  if (extracted.length === 0 && lines.length > 0) {
    const fallbackLines = lines.filter((line) => line.length >= 4).slice(0, 60);
    for (const line of fallbackLines) {
      const value = sanitizeValue(line);
      const dedupeKey = `line::${value.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      extracted.push({
        id: `ef_${extracted.length + 1}`,
        label: `Line ${extracted.length + 1}`,
        value,
        confidence: 0.35
      });
    }
  }

  return extracted;
}

export async function extractFieldsFromPdfBuffer(buffer: Buffer): Promise<ExtractedField[]> {
  const parsed = await pdf(buffer);
  const rawText = parsed.text.trim();
  const scanned = !rawText || rawText.length < 20 || isWatermarkOnly(rawText);

  // If text-based PDF with real content, try text extraction first
  if (!scanned) {
    const fields = extractFieldsFromText(parsed.text);
    if (fields.length > 0) {
      return fields;
    }
  }

  // Try OCR for scanned docs or when text extraction found nothing
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "documap-upload-"));
  const tmpPdf = path.join(tmpDir, "upload.pdf");
  try {
    await fs.writeFile(tmpPdf, buffer);
    const ocrText = await extractTextWithOcr(tmpPdf);
    if (ocrText.trim()) {
      const fields = extractFieldsFromText(ocrText);
      if (fields.length > 0) {
        return fields;
      }

      // Even if no structured fields, return raw OCR lines
      const ocrLines = ocrText.split(/\r?\n/).filter(l => l.trim().length > 2);
      if (ocrLines.length > 0) {
        return ocrLines.slice(0, 100).map((line, idx) => ({
          id: `ef_${idx + 1}`,
          label: `Content ${idx + 1}`,
          value: sanitizeValue(line).slice(0, 500),
          confidence: 0.3
        }));
      }
    }

    // Last resort: return raw text lines from parsed PDF (only if not watermark-only)
    if (!scanned && rawText.length > 10) {
      const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 2);
      return lines.slice(0, 100).map((line, idx) => ({
        id: `ef_${idx + 1}`,
        label: `Content ${idx + 1}`,
        value: sanitizeValue(line).slice(0, 500),
        confidence: 0.2
      }));
    }

    return [];
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function extractFieldsFromPdfPath(sourcePath: string): Promise<ExtractedField[]> {
  const resolvedPath = normalizeSourcePath(sourcePath);
  const ext = path.extname(resolvedPath).toLowerCase();
  if (ext !== ".pdf") {
    throw new Error(`Unsupported file extension ${ext || "(none)"}; only .pdf is supported`);
  }

  const buffer = await fs.readFile(resolvedPath);
  const parsed = await pdf(buffer);
  const rawText = parsed.text.trim();
  const scanned = !rawText || rawText.length < 20 || isWatermarkOnly(rawText);

  if (!scanned) {
    const fields = extractFieldsFromText(parsed.text);
    if (fields.length > 0) {
      return fields;
    }
  }

  // Try OCR for scanned docs or when text extraction found nothing
  const ocrText = await extractTextWithOcr(resolvedPath);
  if (ocrText.trim()) {
    const fields = extractFieldsFromText(ocrText);
    if (fields.length > 0) {
      return fields;
    }

    const ocrLines = ocrText.split(/\r?\n/).filter(l => l.trim().length > 2);
    if (ocrLines.length > 0) {
      return ocrLines.slice(0, 100).map((line, idx) => ({
        id: `ef_${idx + 1}`,
        label: `Content ${idx + 1}`,
        value: sanitizeValue(line).slice(0, 500),
        confidence: 0.3
      }));
    }
  }

  // Last resort: return raw text lines from parsed PDF (only if not watermark-only)
  if (!scanned && rawText.length > 10) {
    const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 2);
    return lines.slice(0, 100).map((line, idx) => ({
      id: `ef_${idx + 1}`,
      label: `Content ${idx + 1}`,
      value: sanitizeValue(line).slice(0, 500),
      confidence: 0.2
    }));
  }

  return [];
}

// ─── Finance-domain extraction (Gemini AI + synonym map) ─────────────────────

export type FinancialExtractionResult = {
  fields: Partial<Record<OutputFieldKey, number>>;
  unmappedFields: { rawLabel: string; rawValue: string }[];
  confidence: "high" | "medium" | "low";
  note: string;
};

function buildGeminiPrompt(pdfText: string, financialYear: string): string {
  const synonymLines = OUTPUT_FIELDS.map((f) => {
    const synonyms = SYNONYM_MAP[f.key].join(" / ");
    return `  - "${f.label}" (also known as: ${synonyms})`;
  }).join("\n");

  const fySection = financialYear
    ? `The document may contain figures for multiple years. Extract values only for the financial year "${financialYear}". If the year appears in a column header, use that column.`
    : `If the document has multiple years, extract the most recent year's figures.`;

  return `You are an expert financial data extractor specialising in dealer/automotive franchise audited financials (Trial Balance, Profit & Loss, Balance Sheet, Trading Account).

${fySection}

Extract exactly these 10 financial figures from the document:
${synonymLines}

Rules:
1. Match each field using the primary name OR any of its known aliases — all comparisons are case-insensitive.
2. The document may use these section headings: Balance Sheet, Profit & Loss Account, P&L, Trading Account, Trial Balance, Income Statement. Search all sections.
3. Strip commas from numbers. Convert bracket notation (1,23,456) to -123456. Remove ₹ / $ / £ symbols.
4. Return ONLY valid JSON — no markdown fences, no explanation, just the raw JSON object.
5. Omit a key from "mapped" if you cannot find a reliable value for it.
6. Place numeric values you found but could not match to the 10 fields in "unmapped".

Return format (strict JSON):
{
  "mapped": {
    "owners_capital": 1234567,
    "total_liabilities": 9876543,
    "pbit": 345678,
    "interest": 12000,
    "accounts_payable": 500000,
    "purchases": 8000000,
    "accounts_receivable": 600000,
    "dealer_turnover": 10000000,
    "current_assets": 2000000,
    "current_liabilities": 1500000
  },
  "unmapped": [
    { "label": "Advance from Customers", "value": 45000 }
  ]
}

DOCUMENT TEXT:
---
${pdfText.slice(0, 28000)}
---`;
}

function synonymMatch(rawText: string): Partial<Record<OutputFieldKey, number>> {
  const result: Partial<Record<OutputFieldKey, number>> = {};
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const lineEntries: { text: string; num: number }[] = [];
  for (const line of lines) {
    const numMatch = line.match(/[₹$€£¥]?\s*\(?-?\d[\d,]*(?:\.\d+)?\)?/);
    if (numMatch) {
      const raw = numMatch[0].replace(/[₹$€£¥,\s]/g, "").replace(/\((.+)\)/, "-$1");
      const n = parseFloat(raw);
      if (isFinite(n)) lineEntries.push({ text: line.toLowerCase(), num: n });
    }
  }

  for (const field of OUTPUT_FIELDS) {
    const synonyms = SYNONYM_MAP[field.key].map((s) => s.toLowerCase());
    for (const entry of lineEntries) {
      if (synonyms.some((syn) => entry.text.includes(syn))) {
        result[field.key] = entry.num;
        break;
      }
    }
  }
  return result;
}

export async function extractFinancialFields(
  buffer: Buffer,
  financialYear: string,
  geminiApiKey?: string
): Promise<FinancialExtractionResult> {
  const apiKey = geminiApiKey?.trim() || (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "");

  // ── 1. Gemini multimodal (primary path for ALL PDFs, scanned or text-based) ─
  // Gemini performs its own OCR — no pre-text extraction needed.
  if (apiKey) {
    try {
      const result = await extractWithGeminiMultimodal(buffer, financialYear, apiKey);
      if (result) return result;
    } catch (err) {
      console.warn("[pdf-extractor] Gemini multimodal extraction failed:", err);
    }
  }

  // ── 2. Fallback: extract text via pdf-parse then OCR ──────────────────────
  let rawText = "";
  try {
    const parsed = await pdf(buffer);
    rawText = parsed.text?.trim() ?? "";
  } catch {
    rawText = "";
  }

  if (!rawText || rawText.length < 50) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-fin-"));
    const tmpPdf = path.join(tmpDir, "doc.pdf");
    try {
      await fs.writeFile(tmpPdf, buffer);
      rawText = await extractTextWithOcr(tmpPdf);
    } catch {
      rawText = "";
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  if (!rawText || rawText.length < 20) {
    return {
      fields: {},
      unmappedFields: [],
      confidence: "low",
      note: apiKey
        ? "Gemini extraction failed and no readable text found in PDF."
        : "GEMINI_API_KEY not configured and no readable text found in PDF.",
    };
  }

  // ── 3. Gemini text-based extraction (text PDFs, multimodal not available) ──
  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = buildGeminiPrompt(rawText, financialYear);
      const response = await model.generateContent(prompt);
      const text = response.response.text().trim();
      const jsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const geminiResult = JSON.parse(jsonText);
      const mapped = (geminiResult.mapped ?? {}) as Partial<Record<OutputFieldKey, number>>;
      const unmappedRaw = (geminiResult.unmapped ?? []) as { label: string; value: number }[];
      const mappedCount = OUTPUT_FIELDS.filter((f) => mapped[f.key] != null).length;
      const confidence: FinancialExtractionResult["confidence"] =
        mappedCount >= 8 ? "high" : mappedCount >= 5 ? "medium" : "low";
      return {
        fields: mapped,
        unmappedFields: unmappedRaw.map((u) => ({ rawLabel: u.label, rawValue: String(u.value) })),
        confidence,
        note: `Gemini AI extracted ${mappedCount}/10 fields from PDF text.`,
      };
    } catch (err) {
      console.warn("[pdf-extractor] Gemini text extraction failed, falling back to synonym match:", err);
    }
  }

  // ── 4. Synonym-map fallback ────────────────────────────────────────────────
  const synonymResult = synonymMatch(rawText);
  const mappedCount = Object.keys(synonymResult).length;
  return {
    fields: synonymResult,
    unmappedFields: [],
    confidence: mappedCount >= 8 ? "medium" : "low",
    note: apiKey
      ? `Gemini unavailable; synonym matching found ${mappedCount}/10 fields.`
      : `GEMINI_API_KEY not configured; synonym matching found ${mappedCount}/10 fields.`,
  };
}

/**
 * Send the raw PDF bytes to Gemini as a multimodal document.
 * Gemini performs its own OCR — works for scanned/image-based PDFs.
 */
async function extractWithGeminiMultimodal(
  buffer: Buffer,
  financialYear: string,
  apiKey: string
): Promise<FinancialExtractionResult | null> {
  const synonymLines = OUTPUT_FIELDS.map((f) => {
    const synonyms = SYNONYM_MAP[f.key].join(" / ");
    return `  - "${f.label}" (also known as: ${synonyms})`;
  }).join("\n");

  const fySection = financialYear
    ? `The document may contain figures for multiple years. Extract values only for the financial year "${financialYear}". If the year appears in a column header, use that column.`
    : `If the document has multiple years, extract the most recent year's figures.`;

  const prompt = `You are an expert financial data extractor specialising in dealer/automotive franchise audited financials (Trial Balance, Profit & Loss, Balance Sheet, Trading Account).

${fySection}

Extract exactly these 10 financial figures from the document. The document may be a scanned image — read it carefully:
${synonymLines}

Rules:
1. Match each field using the primary name OR any of its known aliases — all comparisons are case-insensitive.
2. The document may use these section headings: Balance Sheet, Profit & Loss Account, P&L, Trading Account, Trial Balance, Income Statement. Search all sections.
3. Strip commas from numbers. Convert bracket notation (1,23,456) to -123456. Remove ₹ / $ / £ symbols.
4. Return ONLY valid JSON — no markdown fences, no explanation, just the raw JSON object.
5. Omit a key from "mapped" if you cannot find a reliable value for it.
6. Place numeric values you found but could not match to the 10 fields in "unmapped".

Return format (strict JSON):
{
  "mapped": {
    "owners_capital": 1234567,
    "total_liabilities": 9876543,
    "pbit": 345678,
    "interest": 12000,
    "accounts_payable": 500000,
    "purchases": 8000000,
    "accounts_receivable": 600000,
    "dealer_turnover": 10000000,
    "current_assets": 2000000,
    "current_liabilities": 1500000
  },
  "unmapped": [
    { "label": "Advance from Customers", "value": 45000 }
  ]
}`;

  const base64 = buffer.toString("base64");
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];

  for (const modelName of models) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const response = await model.generateContent([
        {
          inlineData: {
            mimeType: "application/pdf",
            data: base64,
          },
        },
        prompt,
      ]);

      const text = response.response.text().trim();
      if (!text) continue;

      console.log(`[pdf-extractor] Gemini ${modelName} multimodal (first 300):`, text.slice(0, 300));

      const jsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const geminiResult = JSON.parse(jsonText);
      const mapped = (geminiResult.mapped ?? {}) as Partial<Record<OutputFieldKey, number>>;
      const unmappedRaw = (geminiResult.unmapped ?? []) as { label: string; value: number }[];
      const mappedCount = OUTPUT_FIELDS.filter((f) => mapped[f.key] != null).length;
      const confidence: FinancialExtractionResult["confidence"] =
        mappedCount >= 8 ? "high" : mappedCount >= 5 ? "medium" : "low";

      return {
        fields: mapped,
        unmappedFields: unmappedRaw.map((u) => ({ rawLabel: u.label, rawValue: String(u.value) })),
        confidence,
        note: `Gemini AI (${modelName}) extracted ${mappedCount}/10 fields via multimodal OCR.`,
      };
    } catch (err: any) {
      const status = err?.status ?? err?.httpErrorCode ?? 0;
      console.warn(`[pdf-extractor] Gemini ${modelName} multimodal failed (${status}):`, err?.message ?? err);
      if ([400, 404].includes(Number(status))) continue;
      throw err;
    }
  }
  return null;
}
