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
      outputFields[row.targetKey] = value;
    } else {
      outputTables[row.targetKey] = value;
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
      fields: outputFields,
      tables: outputTables
    },
    unmappedSourceFields,
    downloadFileName: `mapped_${sourceFile.fileName.replace(/\.pdf$/i, "")}.json`
  });
});
