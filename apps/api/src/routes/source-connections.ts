import { Router } from "express";
import { z } from "zod";
import {
  getTenantSourceConnections,
  type SourceConnectionRecord
} from "../lib/tenant-store.js";

const sourceConnectionSchema = z.object({
  name: z.string().min(2),
  inputFolderPath: z.string().min(3),
  outputFolderPath: z.string().min(3),
  protocol: z.enum(["smb", "nfs", "local-agent"]).default("local-agent")
});

export const sourceConnectionsRouter = Router();

sourceConnectionsRouter.get("/", (req, res) => {
  const items = getTenantSourceConnections(req.tenantId);
  res.json({ items, tenantId: req.tenantId });
});

sourceConnectionsRouter.post("/", (req, res) => {
  const parsed = sourceConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error.flatten());
  }

  const items = getTenantSourceConnections(req.tenantId);

  const duplicate = items.find(
    (i) => i.inputFolderPath === parsed.data.inputFolderPath && i.outputFolderPath === parsed.data.outputFolderPath
  );
  if (duplicate) {
    return res.status(409).json({ error: "Connection already exists", id: duplicate.id });
  }

  const record: SourceConnectionRecord = {
    id: `src_${Date.now()}`,
    name: parsed.data.name,
    inputFolderPath: parsed.data.inputFolderPath,
    outputFolderPath: parsed.data.outputFolderPath,
    protocol: parsed.data.protocol,
    active: true,
    createdAt: new Date().toISOString()
  };

  items.push(record);
  return res.status(201).json({ ...record, tenantId: req.tenantId });
});

sourceConnectionsRouter.patch("/:id/deactivate", (req, res) => {
  const items = getTenantSourceConnections(req.tenantId);
  const idx = items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Connection not found" });
  }
  items[idx] = { ...items[idx], active: false };
  return res.json({ ...items[idx], tenantId: req.tenantId });
});
