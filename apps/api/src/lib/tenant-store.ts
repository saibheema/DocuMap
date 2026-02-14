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

export type JobRecord = {
  id: string;
  fileId: string;
  templateId?: string;
  overrideTemplate?: boolean;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
};

export type UploadRecord = {
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

export type SourceConnectionRecord = {
  id: string;
  name: string;
  inputFolderPath: string;
  outputFolderPath: string;
  protocol: "smb" | "nfs" | "local-agent";
  active: boolean;
  createdAt: string;
};

const templatesByTenant = new Map<string, TemplateRecord[]>();
const jobsByTenant = new Map<string, JobRecord[]>();
const uploadsByTenant = new Map<string, UploadRecord[]>();
const sourceConnectionsByTenant = new Map<string, SourceConnectionRecord[]>();

function getOrInit<T>(map: Map<string, T[]>, tenantId: string): T[] {
  const existing = map.get(tenantId);
  if (existing) {
    return existing;
  }
  const created: T[] = [];
  map.set(tenantId, created);
  return created;
}

export function getTenantTemplates(tenantId: string) {
  return getOrInit(templatesByTenant, tenantId);
}

export function setTenantTemplates(tenantId: string, templates: TemplateRecord[]) {
  templatesByTenant.set(tenantId, templates);
}

export function getTenantJobs(tenantId: string) {
  return getOrInit(jobsByTenant, tenantId);
}

export function getTenantUploads(tenantId: string) {
  return getOrInit(uploadsByTenant, tenantId);
}

export function getTenantSourceConnections(tenantId: string) {
  return getOrInit(sourceConnectionsByTenant, tenantId);
}

export function getTenantSnapshot(tenantId: string) {
  return {
    uploads: getTenantUploads(tenantId),
    jobs: getTenantJobs(tenantId),
    sourceConnections: getTenantSourceConnections(tenantId)
  };
}
