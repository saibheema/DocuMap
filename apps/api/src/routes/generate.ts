import { Router } from "express";
import { z } from "zod";
import { getTenantUploads } from "../lib/tenant-store.js";

const mappingSchema = z.object({
  sourceType: z.enum(["field", "table"]),
  sourceKey: z.string().min(1),
  targetType: z.enum(["field", "table"]),
  targetKey: z.string().min(1)
});

const generateSchema = z.object({
  fileId: z.string().min(1),
  mappings: z.array(mappingSchema).min(1)
});

/**
 * Merge values when the same target key is mapped more than once.
 * Numbers → sum; text → append with " + ".
 */
function mergeValue(existing: string | undefined, incoming: string): string {
  if (existing === undefined) return incoming;
  const numA = parseNumber(existing);
  const numB = parseNumber(incoming);
  if (numA !== null && numB !== null) {
    return formatNumber(numA + numB, existing);
  }
  return `${existing} + ${incoming}`;
}

/** Parse a numeric string, stripping currency symbols, commas, and parens. */
function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[₹$€£¥%\s]/g, "").replace(/^\((.+)\)$/, "-$1").replace(/,/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Format summed number, preserving comma style from the original value. */
function formatNumber(n: number, reference: string): string {
  // Detect Indian-style formatting (e.g. 12,34,567.89)
  const isIndian = /\d{1,2},\d{2},\d{3}/.test(reference);
  const abs = Math.abs(n);
  let formatted: string;
  if (isIndian) {
    const [intPart, decPart] = abs.toString().split(".");
    const lastThree = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree : lastThree;
    formatted = decPart ? `${grouped}.${decPart}` : grouped;
  } else {
    formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 10 });
  }
  // Restore currency prefix if present
  const currMatch = reference.match(/^[₹$€£¥]/);
  const prefix = currMatch ? currMatch[0] : "";
  return n < 0 ? `${prefix}-${formatted}` : `${prefix}${formatted}`;
}

export const generateRouter = Router();

generateRouter.post("/", (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const uploads = getTenantUploads(req.tenantId);
  const sourceFile = uploads.find((u) => u.fileId === parsed.data.fileId);
  if (!sourceFile) {
    return res.status(404).json({ error: "Source file reference not found" });
  }

  const sourceByKey = new Map<string, string>();
  for (const f of sourceFile.extractedFields) {
    sourceByKey.set(f.id, f.value);
    sourceByKey.set(f.label, f.value);
  }

  const outputFields: Record<string, string> = {};
  const outputTables: Record<string, string> = {};

  for (const row of parsed.data.mappings) {
    const value = sourceByKey.get(row.sourceKey);
    if (value === undefined) {
      continue;
    }

    if (row.targetType === "field") {
      outputFields[row.targetKey] = mergeValue(outputFields[row.targetKey], value);
    } else {
      outputTables[row.targetKey] = mergeValue(outputTables[row.targetKey], value);
    }
  }

  const mappedSourceKeys = new Set(parsed.data.mappings.map((m) => m.sourceKey));
  const unmappedSourceFields = sourceFile.extractedFields
    .filter((f) => !mappedSourceKeys.has(f.id) && !mappedSourceKeys.has(f.label))
    .map((f) => ({ id: f.id, label: f.label }));

  return res.status(200).json({
    tenantId: req.tenantId,
    fileId: sourceFile.fileId,
    sourceFileName: sourceFile.fileName,
    generatedAt: new Date().toISOString(),
    output: {
      fields: { "Source File": sourceFile.fileName, ...outputFields },
      tables: outputTables
    },
    unmappedSourceFields,
    downloadFileName: `mapped_${sourceFile.fileName.replace(/\.pdf$/i, "")}.json`
  });
});
