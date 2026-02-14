import { Router } from "express";
import { getTenantSnapshot } from "../lib/tenant-store.js";
import { listTemplates } from "../lib/template-repository.js";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (req, res) => {
  const snapshot = getTenantSnapshot(req.tenantId);
  const templates = await listTemplates(req.tenantId);

  const completedJobs = snapshot.jobs.filter((j) => j.status === "completed").length;
  const automationRate = snapshot.jobs.length
    ? Number(((completedJobs / snapshot.jobs.length) * 100).toFixed(1))
    : 0;

  res.json({
    tenantId: req.tenantId,
    metrics: {
      templates: templates.length,
      activeTemplates: templates.filter((t) => t.active).length,
      uploads: snapshot.uploads.length,
      jobs: snapshot.jobs.length,
      sourceConnections: snapshot.sourceConnections.length,
      automationRate
    }
  });
});
