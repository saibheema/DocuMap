import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { getTenantJobs, getTenantUploads } from "../lib/tenant-store.js";
import { extractFieldsFromPdfBuffer, extractFieldsFromPdfPath } from "../lib/pdf-extractor.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB
});

const ingestByReferenceSchema = z.object({
  fileName: z
    .string()
    .min(1),
  sourcePath: z.string().min(3),
  outputPath: z.string().min(3).optional(),
  extractedFields: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        label: z.string().min(1),
        value: z.string(),
        confidence: z.number().min(0).max(1).optional()
      })
    )
    .optional()
});

const updateUploadStatusSchema = z.object({
  status: z.enum(["queued", "mapped", "exported"]),
  outputPath: z.string().min(3).optional()
});

export const uploadRouter = Router();

uploadRouter.post("/file", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "file is required" });
  }

  // Accept any PDF file name — no prefix requirement
  if (!file.originalname.trim()) {
    return res
      .status(400)
      .json({ error: "file must have a name", fileName: file.originalname });
  }

  let extractedFields: { id: string; label: string; value: string; confidence: number }[] = [];
  try {
    console.log(`[upload] Processing ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
    extractedFields = await extractFieldsFromPdfBuffer(file.buffer);
    console.log(`[upload] Extracted ${extractedFields.length} fields from ${file.originalname}`);
  } catch (error) {
    console.error(`[upload] Extraction error for ${file.originalname}:`, error);
    return res.status(400).json({
      error: "Failed to extract fields from uploaded PDF",
      details: error instanceof Error ? error.message : "unknown"
    });
  }

  const fileId = `file_${Date.now()}`;
  const uploads = getTenantUploads(req.tenantId);
  const jobs = getTenantJobs(req.tenantId);

  uploads.push({
    fileId,
    fileName: file.originalname,
    sourcePath: `uploaded://${file.originalname}`,
    outputPath: req.body?.outputPath,
    createdAt: new Date().toISOString(),
    status: extractedFields.length > 0 ? "mapped" : "queued",
    extractedFields
  });

  jobs.push({
    id: `job_${Date.now()}`,
    fileId,
    status: extractedFields.length > 0 ? "completed" : "queued",
    createdAt: new Date().toISOString()
  });

  return res.status(201).json({
    tenantId: req.tenantId,
    fileId,
    fileName: file.originalname,
    sourcePath: `uploaded://${file.originalname}`,
    status: extractedFields.length > 0 ? "mapped" : "queued",
    extractedFieldCount: extractedFields.length,
    fields: extractedFields,
    note:
      extractedFields.length > 0
        ? "fields extracted from uploaded PDF"
        : "no clear key-value pairs detected; try a text-based PDF with visible labels"
  });
});

uploadRouter.get("/", (req, res) => {
  const uploads = getTenantUploads(req.tenantId);
  return res.json({ items: uploads, tenantId: req.tenantId });
});

uploadRouter.post("/", async (req, res) => {
  const parsed = ingestByReferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid ingestion payload",
      details: parsed.error.flatten(),
      hint: "Send fileName and sourcePath (network folder reference)."
    });
  }

  const fileId = `file_${Date.now()}`;
  const uploads = getTenantUploads(req.tenantId);
  const jobs = getTenantJobs(req.tenantId);

  let extractedFields =
    parsed.data.extractedFields?.map((f, index) => ({
      id: f.id || `ef_${index + 1}`,
      label: f.label,
      value: f.value,
      confidence: f.confidence
    })) || [];

  let extractionNote: string | undefined;
  if (extractedFields.length === 0) {
    try {
      extractedFields = await extractFieldsFromPdfPath(parsed.data.sourcePath);
      extractionNote = "extracted from PDF source path";
    } catch (error) {
      extractionNote =
        error instanceof Error ? `extraction skipped: ${error.message}` : "extraction skipped";
    }
  }

  const hasExtractedFields = extractedFields.length > 0;

  uploads.push({
    fileId,
    fileName: parsed.data.fileName,
    sourcePath: parsed.data.sourcePath,
    outputPath: parsed.data.outputPath,
    createdAt: new Date().toISOString(),
    status: hasExtractedFields ? "mapped" : "queued",
    extractedFields
  });

  jobs.push({
    id: `job_${Date.now()}`,
    fileId,
    status: hasExtractedFields ? "completed" : "queued",
    createdAt: new Date().toISOString()
  });

  return res.status(202).json({
    tenantId: req.tenantId,
    fileId,
    mode: "reference-only",
    fileName: parsed.data.fileName,
    sourcePath: parsed.data.sourcePath,
    status: hasExtractedFields ? "mapped" : "queued",
    next: hasExtractedFields ? "ready_for_mapping" : "extraction_pending",
    extractionNote
  });
});

uploadRouter.patch("/:id/status", (req, res) => {
  const parsed = updateUploadStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const uploads = getTenantUploads(req.tenantId);
  const idx = uploads.findIndex((u) => u.fileId === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Upload reference not found" });
  }

  uploads[idx] = {
    ...uploads[idx],
    status: parsed.data.status,
    outputPath: parsed.data.outputPath ?? uploads[idx].outputPath
  };

  return res.json({ ...uploads[idx], tenantId: req.tenantId });
});

uploadRouter.post("/:id/process", async (req, res) => {
  const uploads = getTenantUploads(req.tenantId);
  const jobs = getTenantJobs(req.tenantId);
  const idx = uploads.findIndex((u) => u.fileId === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Upload reference not found" });
  }

  const upload = uploads[idx];
  let job = jobs.find((j) => j.fileId === upload.fileId);
  if (!job) {
    job = {
      id: `job_${Date.now()}`,
      fileId: upload.fileId,
      status: "queued",
      createdAt: new Date().toISOString()
    };
    jobs.push(job);
  }

  if (upload.extractedFields.length === 0) {
    try {
      upload.extractedFields = await extractFieldsFromPdfPath(upload.sourcePath);
    } catch (error) {
      job.status = "failed";
      return res.status(400).json({
        tenantId: req.tenantId,
        error: "Cannot process without extracted fields",
        hint: "Provide a readable PDF sourcePath or send extractedFields in ingestion payload.",
        details: error instanceof Error ? error.message : "extraction failed",
        job
      });
    }
  }

  job.status = "processing";
  upload.status = "mapped";
  if (!upload.outputPath) {
    upload.outputPath = `${upload.sourcePath}.mapped.json`;
  }
  job.status = "completed";

  return res.json({ tenantId: req.tenantId, upload, job });
});
