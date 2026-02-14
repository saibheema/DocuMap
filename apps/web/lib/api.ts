const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || "default-tenant";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": TENANT_ID
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
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
  outputFormat: "pdf" | "excel" | "text";
  mappings: Array<{
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
  }>;
  createdAt: string;
  fileNameOnDisk: string;
};

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
  }>("/dashboard/summary");
}

export function listConnections() {
  return request<{ items: SourceConnection[] }>("/source-connections");
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
  return request<{ items: UploadReference[] }>("/upload");
}

export function createUploadReference(payload: {
  fileName: string;
  sourcePath: string;
  outputPath?: string;
  extractedFields?: Array<{ id?: string; label: string; value: string; confidence?: number }>;
}) {
  return request<UploadReference>("/upload", { method: "POST", body: payload });
}

export async function uploadSourcePdf(file: File, outputPath?: string) {
  const form = new FormData();
  form.append("file", file);
  if (outputPath) {
    form.append("outputPath", outputPath);
  }

  const response = await fetch(`${API_URL}/upload/file`, {
    method: "POST",
    headers: {
      "x-tenant-id": TENANT_ID
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed: ${response.status}`);
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
  });
}

export function listTemplates() {
  return request<{ items: TemplateRecord[] }>("/templates");
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
  const response = await fetch(`${API_URL}/templates/export`, {
    method: "GET",
    headers: {
      "x-tenant-id": TENANT_ID
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to download mappings: ${response.status}`);
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
  return request<{ items: JobRecord[] }>("/mapping-jobs");
}

export function updateJobStatus(id: string, status: JobRecord["status"]) {
  return request<JobRecord>(`/mapping-jobs/${id}/status`, { method: "PATCH", body: { status } });
}

export function getTenantId() {
  return TENANT_ID;
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
  });
}

export function saveMapping(payload: {
  name: string;
  fileId: string;
  outputFormat: "pdf" | "excel" | "text";
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
  });
}

export function listSavedMappings() {
  return request<{ tenantId: string; items: SavedMappingRecord[] }>("/mappings");
}
