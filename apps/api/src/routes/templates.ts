import { Router } from "express";
import { z } from "zod";
import {
  createTemplate,
  deactivateTemplate,
  exportTemplateBundle,
  findDuplicateDetectionRule,
  getTemplateById,
  importTemplateBundle,
  listTemplates
} from "../lib/template-repository.js";
import type { TemplateRecord } from "../lib/tenant-store.js";

const templateSchema = z.object({
  name: z.string().min(2),
  detectionRule: z.object({
    filenamePattern: z.string().optional(),
    textContains: z.string().optional()
  }),
  mappings: z.array(
    z.object({
      sourceField: z.string(),
      outputField: z.string(),
      transform: z.string().optional()
    })
  )
});

const templateImportSchema = z.object({
  mode: z.enum(["replace", "merge"]).default("replace"),
  templates: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      active: z.boolean().optional(),
      createdAt: z.string().optional(),
      detectionRule: z
        .object({
          filenamePattern: z.string().optional(),
          textContains: z.string().optional()
        })
        .optional(),
      mappings: z
        .array(
          z.object({
            sourceField: z.string(),
            outputField: z.string(),
            transform: z.string().optional()
          })
        )
        .optional()
    })
  )
});

export const templateRouter = Router();

templateRouter.get("/", async (req, res) => {
  const templates = await listTemplates(req.tenantId);
  res.json({ items: templates, tenantId: req.tenantId });
});

templateRouter.get("/export", async (req, res) => {
  const bundle = await exportTemplateBundle(req.tenantId);
  const fileName = `documap-mappings-${req.tenantId}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
  return res.status(200).send(JSON.stringify(bundle, null, 2));
});

templateRouter.post("/import", async (req, res) => {
  const payload = req.body?.templates
    ? req.body
    : {
        mode: req.body?.mode,
        templates: req.body?.bundle?.templates || req.body?.data?.templates || []
      };

  const parsed = templateImportSchema.safeParse(payload);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const result = await importTemplateBundle(req.tenantId, {
    mode: parsed.data.mode,
    templates: parsed.data.templates
  });

  return res.status(200).json({ tenantId: req.tenantId, ...result });
});

templateRouter.post("/", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const duplicateRule = await findDuplicateDetectionRule(req.tenantId, parsed.data.detectionRule);

  if (duplicateRule) {
    return res.status(409).json({
      error: "Detection rule already exists for this tenant",
      existingTemplateId: duplicateRule.id
    });
  }

  const newTemplate = await createTemplate(req.tenantId, parsed.data);
  return res.status(201).json({ ...newTemplate, tenantId: req.tenantId });
});

templateRouter.post("/:id/clone", async (req, res) => {
  const existing = await getTemplateById(req.tenantId, req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Template not found" });
  }

  const clonedInput: Omit<TemplateRecord, "id" | "active" | "createdAt"> = {
    name: `${existing.name} (copy)`,
    detectionRule: existing.detectionRule,
    mappings: existing.mappings
  };
  const cloned = await createTemplate(req.tenantId, clonedInput);

  return res.status(201).json({ ...cloned, tenantId: req.tenantId });
});

templateRouter.patch("/:id/deactivate", async (req, res) => {
  const deactivated = await deactivateTemplate(req.tenantId, req.params.id);
  if (!deactivated) {
    return res.status(404).json({ error: "Template not found" });
  }
  return res.json({ ...deactivated, tenantId: req.tenantId });
});
