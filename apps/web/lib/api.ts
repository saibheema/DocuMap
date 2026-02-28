const isLocalHostRuntime =
  typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

const API_URL = process.env.NEXT_PUBLIC_API_URL || (isLocalHostRuntime ? "http://localhost:4000" : "");
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || "default-tenant";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

function getLocalStorageKey(suffix: string) {
  return `documap:${TENANT_ID}:${suffix}`;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T) {
  if (!canUseLocalStorage()) {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Skip network call entirely when no backend API is configured
  if (!API_URL) {
    throw new Error("No backend API configured.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": TENANT_ID
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
  } catch {
    throw new Error("Backend API is unreachable.");
  }

  if (!response.ok) {
    const text = await response.text();
    const cleanText = text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(cleanText.slice(0, 200) || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export type SourceConnection = {
  id: string;
  name: string;
  inputFolderPath: string;
  outputFolderPath: string;
  protocol: "smb" | "nfs" | "local-agent";
  active: boolean;
  createdAt: string;
};

export type UploadReference = {
  fileId: string;
  fileName: string;
  sourcePath: string;
  outputPath?: string;
  createdAt: string;
  status: "queued" | "mapped" | "exported";
  extractedFields: Array<{
    id: string;
    label: string;
    value: string;
    confidence?: number;
  }>;
};

export type JobRecord = {
  id: string;
  fileId: string;
  templateId?: string;
  overrideTemplate?: boolean;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
};

export type TemplateRecord = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  detectionRule: {
    filenamePattern?: string;
    textContains?: string;
  };
  mappings: Array<{
    sourceField: string;
    outputField: string;
    transform?: string;
  }>;
};

export type SavedMappingRecord = {
  id: string;
  tenantId: string;
  name: string;
  fileId: string;
  fileName: string;
  outputFormat: "pdf" | "excel" | "text" | "csv";
  mappings: Array<{
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
  }>;
  createdAt: string;
  fileNameOnDisk: string;
};

/** A label-based mapping rule stored in memory for cross-file auto-apply. */
export type MappingMemoryEntry = {
  targetKey: string;
  targetType: "field" | "table";
  sourceLabels: string[];          // all normalized label variants that map to this target
  usageCount: number;
  lastUsed: string;                // ISO date
};

function getLocalUploads() {
  return readLocalJson<UploadReference[]>(getLocalStorageKey("uploads"), []);
}

function setLocalUploads(items: UploadReference[]) {
  writeLocalJson(getLocalStorageKey("uploads"), items);
}

function getLocalSavedMappings() {
  return readLocalJson<SavedMappingRecord[]>(getLocalStorageKey("saved-mappings"), []);
}

function setLocalSavedMappings(items: SavedMappingRecord[]) {
  writeLocalJson(getLocalStorageKey("saved-mappings"), items);
}

/** Get stored label-based mapping memory for auto-apply (server → local fallback). */
export async function getMappingMemory(): Promise<MappingMemoryEntry[]> {
  try {
    const store = await request<{ entries: MappingMemoryEntry[] }>("/mapping-memory");
    // Cache in localStorage for offline fallback
    writeLocalJson(getLocalStorageKey("mapping-memory"), store.entries);
    return store.entries;
  } catch {
    return readLocalJson<MappingMemoryEntry[]>(getLocalStorageKey("mapping-memory"), []);
  }
}

/**
 * Learn mappings into memory: given a set of mapping rows and extracted fields,
 * store label→target rules on the server so they can be auto-applied to future files.
 * Falls back to local-only storage when the API is unreachable.
 */
export async function learnMappings(
  mappings: Array<{
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
  }>,
  extractedFields: Array<{ id: string; label: string; value: string }>
) {
  try {
    await request("/mapping-memory/learn", {
      method: "POST",
      body: { mappings, extractedFields }
    });
  } catch {
    // Fallback: learn locally so memory works even without API
    const fieldById = new Map<string, string>();
    for (const f of extractedFields) {
      fieldById.set(f.id, f.label);
    }

    const memory = readLocalJson<MappingMemoryEntry[]>(getLocalStorageKey("mapping-memory"), []);
    const now = new Date().toISOString();

    for (const m of mappings) {
      if (!m.sourceKey || !m.targetKey) continue;
      const sourceLabel = (fieldById.get(m.sourceKey) || m.sourceKey).toLowerCase().trim();
      if (!sourceLabel) continue;

      const existing = memory.find((e) => e.targetKey === m.targetKey);
      if (existing) {
        if (!existing.sourceLabels.includes(sourceLabel)) {
          existing.sourceLabels.push(sourceLabel);
        }
        existing.usageCount += 1;
        existing.lastUsed = now;
      } else {
        memory.push({
          targetKey: m.targetKey,
          targetType: m.targetType,
          sourceLabels: [sourceLabel],
          usageCount: 1,
          lastUsed: now
        });
      }
    }

    writeLocalJson(getLocalStorageKey("mapping-memory"), memory);
  }
}

/**
 * Auto-apply mapping memory to a new file's extracted fields.
 * Calls the server for fuzzy multi-label matching; falls back to local exact matching.
 */
export async function autoApplyMappings(
  extractedFields: Array<{ id: string; label: string; value: string }>
): Promise<Array<{
  id: string;
  sourceType: "field" | "table";
  sourceKey: string;
  targetType: "field" | "table";
  targetKey: string;
  autoApplied: boolean;
  confidence?: number;
}>> {
  // Try server-side fuzzy matching first
  try {
    const result = await request<{
      matches: Array<{
        fieldId: string;
        fieldLabel: string;
        targetKey: string;
        targetType: "field" | "table";
        confidence: number;
        matchedLabel: string;
      }>;
    }>("/mapping-memory/auto-apply", {
      method: "POST",
      body: { extractedFields }
    });

    if (result.matches.length > 0) {
      return result.matches.map((m, i) => ({
        id: `row_auto_${Date.now()}_${i + 1}`,
        sourceType: "field" as const,
        sourceKey: m.fieldId,
        targetType: m.targetType,
        targetKey: m.targetKey,
        autoApplied: true,
        confidence: m.confidence
      }));
    }
  } catch {
    // Fall through to local matching below
  }

  // Fallback: local exact matching using localStorage
  const memory = readLocalJson<MappingMemoryEntry[]>(getLocalStorageKey("mapping-memory"), []);
  if (memory.length === 0) return [];

  const labelToId = new Map<string, string>();
  for (const f of extractedFields) {
    labelToId.set(f.label.toLowerCase().trim(), f.id);
  }

  const rows: Array<{
    id: string;
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
    autoApplied: boolean;
  }> = [];

  const usedTargets = new Set<string>();
  const sorted = [...memory].sort((a, b) => b.usageCount - a.usageCount);

  for (const entry of sorted) {
    if (usedTargets.has(entry.targetKey)) continue;
    // Check all label variants for this entry
    let fieldId: string | undefined;
    for (const label of entry.sourceLabels) {
      fieldId = labelToId.get(label);
      if (fieldId) break;
    }
    if (!fieldId) continue;
    usedTargets.add(entry.targetKey);

    rows.push({
      id: `row_auto_${Date.now()}_${rows.length + 1}`,
      sourceType: "field",
      sourceKey: fieldId,
      targetType: entry.targetType,
      targetKey: entry.targetKey,
      autoApplied: true
    });
  }

  return rows;
}

function getLocalJobs() {
  return readLocalJson<JobRecord[]>(getLocalStorageKey("jobs"), []);
}

function setLocalJobs(items: JobRecord[]) {
  writeLocalJson(getLocalStorageKey("jobs"), items);
}

function upsertLocalJob(input: { fileId: string; status: JobRecord["status"]; templateId?: string }) {
  const jobs = getLocalJobs();
  const idx = jobs.findIndex((j) => j.fileId === input.fileId);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], status: input.status, templateId: input.templateId ?? jobs[idx].templateId };
    setLocalJobs(jobs);
    return jobs[idx];
  }

  const created: JobRecord = {
    id: `job_${Date.now()}`,
    fileId: input.fileId,
    status: input.status,
    templateId: input.templateId,
    createdAt: new Date().toISOString()
  };
  setLocalJobs([created, ...jobs]);
  return created;
}

function createLocalUpload(payload: {
  fileName: string;
  sourcePath: string;
  outputPath?: string;
  extractedFields?: Array<{ id?: string; label: string; value: string; confidence?: number }>;
}) {
  const extractedFields = (payload.extractedFields || []).map((f, index) => ({
    id: f.id || `ef_${index + 1}`,
    label: f.label,
    value: f.value,
    confidence: f.confidence
  }));

  const upload: UploadReference = {
    fileId: `file_${Date.now()}`,
    fileName: payload.fileName,
    sourcePath: payload.sourcePath,
    outputPath: payload.outputPath,
    createdAt: new Date().toISOString(),
    status: extractedFields.length > 0 ? "mapped" : "queued",
    extractedFields
  };

  const current = getLocalUploads();
  setLocalUploads([upload, ...current]);
  upsertLocalJob({ fileId: upload.fileId, status: extractedFields.length > 0 ? "completed" : "queued" });
  return upload;
}

export function getDashboardSummary() {
  return request<{
    tenantId: string;
    metrics: {
      templates: number;
      activeTemplates: number;
      uploads: number;
      jobs: number;
      sourceConnections: number;
      automationRate: number;
    };
  }>("/dashboard/summary").catch(() => {
    const uploads = getLocalUploads();
    const jobs = getLocalJobs();
    return {
      tenantId: TENANT_ID,
      metrics: {
        templates: 0,
        activeTemplates: 0,
        uploads: uploads.length,
        jobs: jobs.length,
        sourceConnections: 0,
        automationRate: 0
      }
    };
  });
}

export function listConnections() {
  return request<{ items: SourceConnection[] }>("/source-connections").catch(() => {
    return { items: [] as SourceConnection[] };
  });
}

export function createConnection(payload: {
  name: string;
  inputFolderPath: string;
  outputFolderPath: string;
  protocol: "smb" | "nfs" | "local-agent";
}) {
  return request<SourceConnection>("/source-connections", { method: "POST", body: payload });
}

export function deactivateConnection(id: string) {
  return request<SourceConnection>(`/source-connections/${id}/deactivate`, { method: "PATCH" });
}

export function listUploads() {
  return request<{ items: UploadReference[] }>("/upload").catch(() => {
    return { items: getLocalUploads() };
  });
}

export function createUploadReference(payload: {
  fileName: string;
  sourcePath: string;
  outputPath?: string;
  extractedFields?: Array<{ id?: string; label: string; value: string; confidence?: number }>;
}) {
  return request<UploadReference>("/upload", { method: "POST", body: payload }).catch(() => {
    return createLocalUpload(payload);
  });
}

export async function uploadSourcePdf(file: File, outputPath?: string) {
  // When no backend, go straight to local storage
  if (!API_URL) {
    const upload = createLocalUpload({
      fileName: file.name,
      sourcePath: `browser-upload://${file.name}`,
      outputPath,
      extractedFields: []
    });
    return {
      tenantId: TENANT_ID,
      fileId: upload.fileId,
      fileName: upload.fileName,
      sourcePath: upload.sourcePath,
      status: upload.status,
      extractedFieldCount: upload.extractedFields.length
    };
  }

  const form = new FormData();
  form.append("file", file);
  if (outputPath) {
    form.append("outputPath", outputPath);
  }

  const response = await fetch(`${API_URL}/upload/file`, {
    method: "POST",
    headers: { "x-tenant-id": TENANT_ID },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    const cleanText = text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    throw new Error(cleanText.slice(0, 200) || `Upload failed: ${response.status}`);
  }

  return response.json() as Promise<{
    tenantId: string;
    fileId: string;
    fileName: string;
    sourcePath: string;
    status: string;
    extractedFieldCount: number;
  }>;
}

export function processUploadReference(fileId: string) {
  return request<{ tenantId: string; upload: UploadReference }>(`/upload/${fileId}/process`, {
    method: "POST"
  }).catch(() => {
    const uploads = getLocalUploads();
    const idx = uploads.findIndex((u) => u.fileId === fileId);
    if (idx === -1) {
      throw new Error("Upload reference not found");
    }

    uploads[idx] = {
      ...uploads[idx],
      status: uploads[idx].extractedFields.length > 0 ? "mapped" : uploads[idx].status,
      outputPath: uploads[idx].outputPath || `${uploads[idx].sourcePath}.mapped.json`
    };
    setLocalUploads(uploads);
    upsertLocalJob({
      fileId,
      status: uploads[idx].extractedFields.length > 0 ? "completed" : "queued"
    });
    return { tenantId: TENANT_ID, upload: uploads[idx] };
  });
}

export function listTemplates() {
  return request<{ items: TemplateRecord[] }>("/templates").catch(() => {
    return { items: [] as TemplateRecord[] };
  });
}

export function createTemplate(payload: {
  name: string;
  detectionRule: { filenamePattern?: string; textContains?: string };
  mappings: Array<{ sourceField: string; outputField: string; transform?: string }>;
}) {
  return request<TemplateRecord>("/templates", { method: "POST", body: payload });
}

export function cloneTemplate(id: string) {
  return request<TemplateRecord>(`/templates/${id}/clone`, { method: "POST" });
}

export function deactivateTemplate(id: string) {
  return request<TemplateRecord>(`/templates/${id}/deactivate`, { method: "PATCH" });
}

export async function downloadTemplateMappingsFile() {
  if (!API_URL) {
    throw new Error("Backend API is not configured. Export is not available in local mode.");
  }

  const response = await fetch(`${API_URL}/templates/export`, {
    method: "GET",
    headers: {
      "x-tenant-id": TENANT_ID
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to export templates: ${response.status}`);
  }

  return response.blob();
}

export function importTemplateMappingsFile(payload: {
  mode: "replace" | "merge";
  templates: Array<{
    id?: string;
    name: string;
    active?: boolean;
    createdAt?: string;
    detectionRule?: { filenamePattern?: string; textContains?: string };
    mappings?: Array<{ sourceField: string; outputField: string; transform?: string }>;
  }>;
}) {
  return request<{ tenantId: string; imported: number; total?: number; mode: "replace" | "merge" }>(
    "/templates/import",
    {
      method: "POST",
      body: payload
    }
  );
}

export function listJobs() {
  return request<{ items: JobRecord[] }>("/mapping-jobs").catch(() => {
    const uploads = getLocalUploads();
    const jobs = getLocalJobs();

    const byFileId = new Map(jobs.map((j) => [j.fileId, j]));
    for (const upload of uploads) {
      if (!byFileId.has(upload.fileId)) {
        byFileId.set(upload.fileId, {
          id: `job_backfill_${upload.fileId}`,
          fileId: upload.fileId,
          status: upload.status === "queued" ? "queued" : "completed",
          createdAt: upload.createdAt
        });
      }
    }

    const merged = Array.from(byFileId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setLocalJobs(merged);
    return { items: merged };
  });
}

export function updateJobStatus(id: string, status: JobRecord["status"]) {
  return request<JobRecord>(`/mapping-jobs/${id}/status`, { method: "PATCH", body: { status } }).catch(() => {
    const jobs = getLocalJobs();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) {
      throw new Error("Job not found");
    }

    jobs[idx] = { ...jobs[idx], status };
    setLocalJobs(jobs);
    return jobs[idx];
  });
}

export function getTenantId() {
  return TENANT_ID;
}

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

function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[₹$€£¥%\s]/g, "").replace(/^\((.+)\)$/, "-$1").replace(/,/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function formatNumber(n: number, reference: string): string {
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
  const currMatch = reference.match(/^[₹$€£¥]/);
  const prefix = currMatch ? currMatch[0] : "";
  return n < 0 ? `${prefix}-${formatted}` : `${prefix}${formatted}`;
}

export function generateOutput(payload: {
  fileId: string;
  mappings: Array<{
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
  }>;
}) {
  return request<{
    tenantId: string;
    fileId: string;
    sourceFileName: string;
    generatedAt: string;
    output: {
      fields: Record<string, string>;
      tables: Record<string, string>;
    };
    unmappedSourceFields: Array<{ id: string; label: string }>;
    downloadFileName: string;
  }>("/generate", {
    method: "POST",
    body: payload
  }).catch(() => {
    const uploads = getLocalUploads();
    const sourceFile = uploads.find((u) => u.fileId === payload.fileId);
    if (!sourceFile) {
      throw new Error("Source file reference not found");
    }

    const sourceByKey = new Map<string, string>();
    for (const f of sourceFile.extractedFields) {
      sourceByKey.set(f.id, f.value);
      sourceByKey.set(f.label, f.value);
    }

    const outputFields: Record<string, string> = {};
    const outputTables: Record<string, string> = {};

    for (const row of payload.mappings) {
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

    const mappedSourceKeys = new Set(payload.mappings.map((m) => m.sourceKey));
    const unmappedSourceFields = sourceFile.extractedFields
      .filter((f) => !mappedSourceKeys.has(f.id) && !mappedSourceKeys.has(f.label))
      .map((f) => ({ id: f.id, label: f.label }));

    return {
      tenantId: TENANT_ID,
      fileId: sourceFile.fileId,
      sourceFileName: sourceFile.fileName,
      generatedAt: new Date().toISOString(),
      output: {
        fields: { "Source File": sourceFile.fileName, ...outputFields },
        tables: outputTables
      },
      unmappedSourceFields,
      downloadFileName: `mapped_${sourceFile.fileName.replace(/\.pdf$/i, "")}.json`
    };
  });
}

export function saveMapping(payload: {
  name: string;
  fileId: string;
  outputFormat: "pdf" | "excel" | "text" | "csv";
  mappings: Array<{
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
  }>;
}) {
  return request<SavedMappingRecord>("/mappings", {
    method: "POST",
    body: payload
  }).catch(() => {
    const uploads = getLocalUploads();
    const sourceFile = uploads.find((u) => u.fileId === payload.fileId);
    if (!sourceFile) {
      throw new Error("Source file reference not found");
    }

    const record: SavedMappingRecord = {
      id: `map_${Date.now()}`,
      tenantId: TENANT_ID,
      name: payload.name,
      fileId: payload.fileId,
      fileName: sourceFile.fileName,
      outputFormat: payload.outputFormat,
      mappings: payload.mappings,
      createdAt: new Date().toISOString(),
      fileNameOnDisk: `${TENANT_ID}_local_${payload.name.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}.json`
    };

    const current = getLocalSavedMappings();
    setLocalSavedMappings([record, ...current]);
    return record;
  });
}

export function listSavedMappings() {
  return request<{ tenantId: string; items: SavedMappingRecord[] }>("/mappings").catch(() => {
    return {
      tenantId: TENANT_ID,
      items: getLocalSavedMappings()
    };
  });
}
