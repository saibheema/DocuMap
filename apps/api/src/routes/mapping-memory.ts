import { Router } from "express";
import { z } from "zod";
import {
  loadMappingMemory,
  learnMappings,
  autoApplyFromMemory,
  addSourceLabel,
  removeSourceLabel,
  removeTargetEntry
} from "../lib/mapping-memory-store.js";

const learnSchema = z.object({
  mappings: z.array(z.object({
    sourceType: z.enum(["field", "table"]),
    sourceKey: z.string().min(1),
    targetType: z.enum(["field", "table"]),
    targetKey: z.string().min(1)
  })).min(1),
  extractedFields: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.string()
  })).min(1)
});

const autoApplySchema = z.object({
  extractedFields: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.string()
  })).min(1)
});

export const mappingMemoryRouter = Router();

/** GET /mapping-memory — List all stored mapping memory entries for the tenant */
mappingMemoryRouter.get("/", async (req, res) => {
  try {
    const store = await loadMappingMemory(req.tenantId);
    return res.json(store);
  } catch (e) {
    return res.status(500).json({
      error: "Failed to load mapping memory",
      details: e instanceof Error ? e.message : "unknown"
    });
  }
});

/** POST /mapping-memory/learn — Learn new label→target mappings from confirmed rows */
mappingMemoryRouter.post("/learn", async (req, res) => {
  const parsed = learnSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  try {
    const store = await learnMappings(
      req.tenantId,
      parsed.data.mappings,
      parsed.data.extractedFields
    );
    return res.json({
      tenantId: req.tenantId,
      entryCount: store.entries.length,
      totalLabels: store.entries.reduce((sum, e) => sum + e.sourceLabels.length, 0),
      updatedAt: store.updatedAt
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to learn mappings",
      details: e instanceof Error ? e.message : "unknown"
    });
  }
});

/** POST /mapping-memory/auto-apply — Find matching mappings for a new file's fields */
mappingMemoryRouter.post("/auto-apply", async (req, res) => {
  const parsed = autoApplySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  try {
    const store = await loadMappingMemory(req.tenantId);
    const matches = autoApplyFromMemory(store, parsed.data.extractedFields);
    return res.json({
      tenantId: req.tenantId,
      matchCount: matches.length,
      memoryEntries: store.entries.length,
      matches
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to auto-apply mappings",
      details: e instanceof Error ? e.message : "unknown"
    });
  }
});

/** POST /mapping-memory/add-label — Add a single source label to a target */
mappingMemoryRouter.post("/add-label", async (req, res) => {
  const schema = z.object({
    targetKey: z.string().min(1),
    targetType: z.enum(["field", "table"]).default("field"),
    sourceLabel: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const store = await addSourceLabel(
      req.tenantId,
      parsed.data.targetKey,
      parsed.data.targetType,
      parsed.data.sourceLabel
    );
    return res.json(store);
  } catch (e) {
    return res.status(500).json({
      error: "Failed to add label",
      details: e instanceof Error ? e.message : "unknown"
    });
  }
});

/** POST /mapping-memory/remove-label — Remove a source label from a target */
mappingMemoryRouter.post("/remove-label", async (req, res) => {
  const schema = z.object({
    targetKey: z.string().min(1),
    sourceLabel: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const store = await removeSourceLabel(req.tenantId, parsed.data.targetKey, parsed.data.sourceLabel);
    return res.json(store);
  } catch (e) {
    return res.status(500).json({
      error: "Failed to remove label",
      details: e instanceof Error ? e.message : "unknown"
    });
  }
});

/** DELETE /mapping-memory/:targetKey — Remove an entire target entry */
mappingMemoryRouter.delete("/:targetKey", async (req, res) => {
  try {
    const store = await removeTargetEntry(req.tenantId, req.params.targetKey);
    return res.json(store);
  } catch (e) {
    return res.status(500).json({
      error: "Failed to remove target",
      details: e instanceof Error ? e.message : "unknown"
    });
  }
});
