import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import pdf from "pdf-parse";

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
  return /\(?-?\d[\d,]*(?:\.\d+)?\)?/.test(value);
}

function sanitizeLabel(label: string) {
  return label.replace(/\s+/g, " ").replace(/[:\-]+$/, "").trim();
}

function sanitizeValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
      "3",
      "-png",
      "-r",
      "220",
      pdfPath,
      outputPrefix
    ]);

    const files = await fs.readdir(tmpDir);
    const pageImages = files
      .filter((f) => /^page-\d+\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    let text = "";
    for (const imageName of pageImages) {
      const imagePath = path.join(tmpDir, imageName);
      const { stdout } = await execFile("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", "6"]);
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
  if (!t || t.length < 2 || t.length > 90) {
    return false;
  }
  if (/^[\d\W]+$/.test(t)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9_\s\-/().&:#]*$/.test(t);
}

function isLikelyValue(line: string) {
  const t = line.trim();
  if (!t || t.length < 1 || t.length > 140) {
    return false;
  }

  if (looksLikeAmount(t)) {
    return true;
  }

  if (/^[A-Za-z0-9][A-Za-z0-9_\-/().,:#\s]{1,140}$/.test(t)) {
    return true;
  }

  return false;
}

function extractFromLine(line: string): { label: string; value: string; confidence: number } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 3) {
    return null;
  }

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
  if (wideGapMatch && isLikelyValue(wideGapMatch[2])) {
    return {
      label: sanitizeLabel(wideGapMatch[1]),
      value: sanitizeValue(wideGapMatch[2]),
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
    const fallbackLines = lines.filter((line) => line.length >= 4).slice(0, 20);
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
  let fields = extractFieldsFromText(parsed.text);
  if (fields.length > 0) {
    return fields;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "documap-upload-"));
  const tmpPdf = path.join(tmpDir, "upload.pdf");
  try {
    await fs.writeFile(tmpPdf, buffer);
    const ocrText = await extractTextWithOcr(tmpPdf);
    fields = extractFieldsFromText(ocrText);
    return fields;
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
  let fields = extractFieldsFromText(parsed.text);
  if (fields.length > 0) {
    return fields;
  }

  const ocrText = await extractTextWithOcr(resolvedPath);
  fields = extractFieldsFromText(ocrText);
  return fields;
}
