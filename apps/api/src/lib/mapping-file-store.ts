import fs from "node:fs/promises";
import path from "node:path";

export type SavedMappingRow = {
  sourceType: "field" | "table";
  sourceKey: string;
  targetType: "field" | "table";
  targetKey: string;
};

export type SavedMappingRecord = {
  id: string;
  tenantId: string;
  name: string;
  fileId: string;
  fileName: string;
  outputFormat: "pdf" | "excel" | "text";
  mappings: SavedMappingRow[];
  createdAt: string;
  fileNameOnDisk: string;
};

let cachedRoot: string | null = null;

async function resolveWorkspaceRoot(): Promise<string> {
  if (cachedRoot) {
    return cachedRoot;
  }

  let current = process.cwd();
  for (let i = 0; i < 8; i++) {
    const packageJsonPath = path.join(current, "package.json");
    try {
      const raw = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === "documap") {
        cachedRoot = current;
        return current;
      }
    } catch {
      // ignore and walk up
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  cachedRoot = process.cwd();
  return cachedRoot;
}

async function getMappingsDir() {
  const root = await resolveWorkspaceRoot();
  const dir = path.join(root, "mappings");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function safeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function saveMappingToFile(input: {
  tenantId: string;
  name: string;
  fileId: string;
  fileName: string;
  outputFormat: "pdf" | "excel" | "text";
  mappings: SavedMappingRow[];
}): Promise<SavedMappingRecord> {
  const mappingsDir = await getMappingsDir();
  const id = `map_${Date.now()}`;
  const normalizedName = safeName(input.name) || "mapping";
  const fileNameOnDisk = `${input.tenantId}_${id}_${normalizedName}.json`;

  const record: SavedMappingRecord = {
    id,
    tenantId: input.tenantId,
    name: input.name,
    fileId: input.fileId,
    fileName: input.fileName,
    outputFormat: input.outputFormat,
    mappings: input.mappings,
    createdAt: new Date().toISOString(),
    fileNameOnDisk
  };

  const fullPath = path.join(mappingsDir, fileNameOnDisk);
  await fs.writeFile(fullPath, JSON.stringify(record, null, 2), "utf-8");
  return record;
}

export async function listSavedMappings(tenantId: string): Promise<SavedMappingRecord[]> {
  const mappingsDir = await getMappingsDir();
  const files = await fs.readdir(mappingsDir);

  const items: SavedMappingRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || !file.startsWith(`${tenantId}_`)) {
      continue;
    }

    try {
      const fullPath = path.join(mappingsDir, file);
      const raw = await fs.readFile(fullPath, "utf-8");
      const parsed = JSON.parse(raw) as SavedMappingRecord;
      if (parsed.tenantId === tenantId) {
        items.push(parsed);
      }
    } catch {
      // ignore unreadable files
    }
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
