import { getTenantTemplates, setTenantTemplates, type TemplateRecord } from "./tenant-store.js";

type CreateTemplateInput = Omit<TemplateRecord, "id" | "active" | "createdAt">;

export type TemplateBundle = {
  version: "1.0";
  tenantId: string;
  exportedAt: string;
  templates: TemplateRecord[];
};

export async function listTemplates(tenantId: string): Promise<TemplateRecord[]> {
  return getTenantTemplates(tenantId);
}

export async function findDuplicateDetectionRule(
  tenantId: string,
  detectionRule: TemplateRecord["detectionRule"]
): Promise<TemplateRecord | null> {
  const items = await listTemplates(tenantId);
  return (
    items.find(
      (t) =>
        (t.detectionRule.filenamePattern || "") === (detectionRule.filenamePattern || "") &&
        (t.detectionRule.textContains || "") === (detectionRule.textContains || "")
    ) || null
  );
}

export async function createTemplate(
  tenantId: string,
  input: CreateTemplateInput
): Promise<TemplateRecord> {
  const record: TemplateRecord = {
    id: `tpl_${Date.now()}`,
    active: true,
    createdAt: new Date().toISOString(),
    ...input
  };

  const templates = getTenantTemplates(tenantId);
  templates.push(record);

  return record;
}

export async function getTemplateById(tenantId: string, templateId: string): Promise<TemplateRecord | null> {
  const items = getTenantTemplates(tenantId);
  return items.find((t) => t.id === templateId) || null;
}

export async function deactivateTemplate(
  tenantId: string,
  templateId: string
): Promise<TemplateRecord | null> {
  const items = getTenantTemplates(tenantId);
  const idx = items.findIndex((t) => t.id === templateId);
  if (idx === -1) {
    return null;
  }
  items[idx] = { ...items[idx], active: false };
  return items[idx];
}

export async function exportTemplateBundle(tenantId: string): Promise<TemplateBundle> {
  const templates = await listTemplates(tenantId);
  return {
    version: "1.0",
    tenantId,
    exportedAt: new Date().toISOString(),
    templates
  };
}

function normalizeTemplate(t: Partial<TemplateRecord>): TemplateRecord {
  return {
    id: t.id || `tpl_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: t.name || "Imported Template",
    active: t.active ?? true,
    createdAt: t.createdAt || new Date().toISOString(),
    detectionRule: {
      filenamePattern: t.detectionRule?.filenamePattern,
      textContains: t.detectionRule?.textContains
    },
    mappings: Array.isArray(t.mappings)
      ? t.mappings.map((m) => ({
          sourceField: m.sourceField,
          outputField: m.outputField,
          transform: m.transform
        }))
      : []
  };
}

export async function importTemplateBundle(
  tenantId: string,
  input: { templates: Partial<TemplateRecord>[]; mode: "replace" | "merge" }
) {
  const current = getTenantTemplates(tenantId);
  const normalized = input.templates.map(normalizeTemplate);

  if (input.mode === "replace") {
    setTenantTemplates(tenantId, normalized);
    return { imported: normalized.length, mode: input.mode };
  }

  const byId = new Map(current.map((t) => [t.id, t]));
  for (const item of normalized) {
    byId.set(item.id, item);
  }
  const merged = Array.from(byId.values());
  setTenantTemplates(tenantId, merged);
  return { imported: normalized.length, total: merged.length, mode: input.mode };
}
