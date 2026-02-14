import { Router } from "express";
import { z } from "zod";
import { getTenantUploads } from "../lib/tenant-store.js";
import { listSavedMappings, saveMappingToFile } from "../lib/mapping-file-store.js";

const mappingRowSchema = z.object({
  sourceType: z.enum(["field", "table"]),
  sourceKey: z.string().min(1),
  targetType: z.enum(["field", "table"]),
  targetKey: z.string().min(1)
});

const saveMappingSchema = z.object({
  name: z.string().min(2).max(120),
  fileId: z.string().min(1),
  outputFormat: z.enum(["pdf", "excel", "text"]).default("pdf"),
  mappings: z.array(mappingRowSchema).min(1)
});

export const mappingsRouter = Router();

mappingsRouter.get("/", async (req, res) => {
  const items = await listSavedMappings(req.tenantId);
  return res.json({ tenantId: req.tenantId, items });
});

mappingsRouter.post("/", async (req, res) => {
  const parsed = saveMappingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const uploads = getTenantUploads(req.tenantId);
  const sourceFile = uploads.find((u) => u.fileId === parsed.data.fileId);
  if (!sourceFile) {
    return res.status(404).json({ error: "Source file reference not found" });
  }

  const saved = await saveMappingToFile({
    tenantId: req.tenantId,
    name: parsed.data.name,
    fileId: parsed.data.fileId,
    fileName: sourceFile.fileName,
    outputFormat: parsed.data.outputFormat,
    mappings: parsed.data.mappings
  });

  return res.status(201).json(saved);
});
