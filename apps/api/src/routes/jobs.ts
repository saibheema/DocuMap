import { Router } from "express";
import { z } from "zod";
import { getTenantJobs, getTenantUploads, type JobRecord } from "../lib/tenant-store.js";
import { getTemplateById } from "../lib/template-repository.js";

const createJobSchema = z.object({
  fileId: z.string(),
  templateId: z.string().optional(),
  overrideTemplate: z.boolean().optional()
});

const updateJobStatusSchema = z.object({
  status: z.enum(["queued", "processing", "completed", "failed"])
});

export const jobsRouter = Router();

jobsRouter.get("/", (req, res) => {
  const jobs = getTenantJobs(req.tenantId);
  const uploads = getTenantUploads(req.tenantId);

  for (const upload of uploads) {
    const exists = jobs.some((j) => j.fileId === upload.fileId);
    if (!exists) {
      jobs.push({
        id: `job_backfill_${upload.fileId}`,
        fileId: upload.fileId,
        status: upload.status === "queued" ? "queued" : "completed",
        createdAt: upload.createdAt
      });
    }
  }

  return res.json({ items: jobs, tenantId: req.tenantId });
});

jobsRouter.post("/", async (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const jobs = getTenantJobs(req.tenantId);

  if (parsed.data.templateId) {
    const template = await getTemplateById(req.tenantId, parsed.data.templateId);
    if (!template) {
      return res.status(404).json({ error: "Template not found for tenant" });
    }
  }

  const newJob: JobRecord = {
    id: `job_${Date.now()}`,
    status: "queued",
    createdAt: new Date().toISOString(),
    ...parsed.data
  };

  jobs.push(newJob);
  return res.status(202).json({ ...newJob, tenantId: req.tenantId });
});

jobsRouter.get("/:id", (req, res) => {
  const jobs = getTenantJobs(req.tenantId);
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  return res.json({ ...job, tenantId: req.tenantId });
});

jobsRouter.patch("/:id/status", (req, res) => {
  const parsed = updateJobStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const jobs = getTenantJobs(req.tenantId);
  const idx = jobs.findIndex((j) => j.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Job not found" });
  }

  jobs[idx] = {
    ...jobs[idx],
    status: parsed.data.status
  };
  return res.json({ ...jobs[idx], tenantId: req.tenantId });
});
