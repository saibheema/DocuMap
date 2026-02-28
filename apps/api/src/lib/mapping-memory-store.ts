import fs from "node:fs/promises";
import path from "node:path";
import { getFirestore } from "./firestore.js";

/**
 * A mapping memory entry stores all known source label variants
 * that map to a specific target key. This enables cross-file auto-mapping.
 *
 * Example:
 *   targetKey: "total_assets"
 *   sourceLabels: ["current assets - closing balance", "current assets - balance", "assets - total balance"]
 *   usageCount: 3
 */
export type MappingMemoryEntry = {
  targetKey: string;
  targetType: "field" | "table";
  sourceLabels: string[];      // all known label variants (lowercase, trimmed)
  usageCount: number;
  lastUsed: string;            // ISO date
};

export type MappingMemoryStore = {
  tenantId: string;
  entries: MappingMemoryEntry[];
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// File-based storage (primary, works on Cloud Run with volume mounts)
// ---------------------------------------------------------------------------

let cachedRoot: string | null = null;

async function resolveWorkspaceRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  let current = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(current, "package.json");
    try {
      const raw = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === "documap") { cachedRoot = current; return current; }
    } catch { /* walk up */ }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

async function getMemoryDir() {
  const root = await resolveWorkspaceRoot();
  const dir = path.join(root, "mapping-memory");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function memoryFileName(tenantId: string) {
  return `${tenantId}_mapping-memory.json`;
}

async function loadFromFile(tenantId: string): Promise<MappingMemoryStore> {
  const dir = await getMemoryDir();
  const filePath = path.join(dir, memoryFileName(tenantId));
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as MappingMemoryStore;
  } catch {
    return { tenantId, entries: [], updatedAt: new Date().toISOString() };
  }
}

async function saveToFile(store: MappingMemoryStore) {
  const dir = await getMemoryDir();
  const filePath = path.join(dir, memoryFileName(store.tenantId));
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Firestore storage (optional, preferred when available)
// ---------------------------------------------------------------------------

const COLLECTION = "mapping-memory";

async function loadFromFirestore(tenantId: string): Promise<MappingMemoryStore | null> {
  const db = getFirestore();
  if (!db) return null;
  try {
    const doc = await db.collection(COLLECTION).doc(tenantId).get();
    if (doc.exists) {
      return doc.data() as MappingMemoryStore;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveToFirestore(store: MappingMemoryStore): Promise<boolean> {
  const db = getFirestore();
  if (!db) return false;
  try {
    await db.collection(COLLECTION).doc(store.tenantId).set(store);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the mapping memory for a tenant.
 * Tries Firestore first, falls back to file.
 */
export async function loadMappingMemory(tenantId: string): Promise<MappingMemoryStore> {
  const fromFirestore = await loadFromFirestore(tenantId);
  if (fromFirestore) return fromFirestore;
  return loadFromFile(tenantId);
}

/**
 * Persist the mapping memory for a tenant.
 * Writes to both Firestore (if available) and file (always).
 */
async function persistMappingMemory(store: MappingMemoryStore) {
  store.updatedAt = new Date().toISOString();
  await Promise.all([
    saveToFirestore(store),
    saveToFile(store)
  ]);
}

/**
 * Learn new label→target mappings from a set of user-confirmed mapping rows.
 *
 * For each mapping row:
 *   - Resolves the source label from extractedFields
 *   - Finds or creates a MappingMemoryEntry for the targetKey
 *   - Adds the source label as a new variant if not already known
 *   - Increments usage count
 *
 * This is the core of the "mapping memory" — multiple label variants
 * accumulate over time for each target key.
 */
export async function learnMappings(
  tenantId: string,
  mappings: Array<{
    sourceType: "field" | "table";
    sourceKey: string;
    targetType: "field" | "table";
    targetKey: string;
  }>,
  extractedFields: Array<{ id: string; label: string; value: string }>
): Promise<MappingMemoryStore> {
  const store = await loadMappingMemory(tenantId);
  const now = new Date().toISOString();

  // Build id→label lookup
  const idToLabel = new Map<string, string>();
  for (const f of extractedFields) {
    idToLabel.set(f.id, f.label);
    idToLabel.set(f.label, f.label);
  }

  for (const m of mappings) {
    if (!m.sourceKey || !m.targetKey) continue;
    const rawLabel = idToLabel.get(m.sourceKey) || m.sourceKey;
    const normalizedLabel = rawLabel.toLowerCase().trim();
    if (!normalizedLabel) continue;

    // Find existing entry for this target
    let entry = store.entries.find((e) => e.targetKey === m.targetKey);

    if (entry) {
      // Add label variant if not already known
      if (!entry.sourceLabels.includes(normalizedLabel)) {
        entry.sourceLabels.push(normalizedLabel);
      }
      entry.usageCount += 1;
      entry.lastUsed = now;
      entry.targetType = m.targetType;
    } else {
      // Create new entry
      store.entries.push({
        targetKey: m.targetKey,
        targetType: m.targetType,
        sourceLabels: [normalizedLabel],
        usageCount: 1,
        lastUsed: now
      });
    }
  }

  await persistMappingMemory(store);
  return store;
}

/**
 * Directly add a source label variant to a target. Creates entry if needed.
 * Used by the visual mapping canvas when a user types in a new source label.
 */
export async function addSourceLabel(
  tenantId: string,
  targetKey: string,
  targetType: "field" | "table",
  sourceLabel: string
): Promise<MappingMemoryStore> {
  const store = await loadMappingMemory(tenantId);
  const normalizedLabel = sourceLabel.toLowerCase().trim();
  if (!normalizedLabel) return store;

  let entry = store.entries.find((e) => e.targetKey === targetKey);
  if (entry) {
    if (!entry.sourceLabels.includes(normalizedLabel)) {
      entry.sourceLabels.push(normalizedLabel);
    }
    entry.usageCount += 1;
    entry.lastUsed = new Date().toISOString();
  } else {
    store.entries.push({
      targetKey,
      targetType,
      sourceLabels: [normalizedLabel],
      usageCount: 1,
      lastUsed: new Date().toISOString()
    });
  }

  await persistMappingMemory(store);
  return store;
}

/**
 * Remove a specific source label from a target entry.
 */
export async function removeSourceLabel(
  tenantId: string,
  targetKey: string,
  sourceLabel: string
): Promise<MappingMemoryStore> {
  const store = await loadMappingMemory(tenantId);
  const normalizedLabel = sourceLabel.toLowerCase().trim();
  const entry = store.entries.find((e) => e.targetKey === targetKey);
  if (entry) {
    entry.sourceLabels = entry.sourceLabels.filter((l) => l !== normalizedLabel);
    // Remove entry entirely if no labels left
    if (entry.sourceLabels.length === 0) {
      store.entries = store.entries.filter((e) => e.targetKey !== targetKey);
    }
  }
  await persistMappingMemory(store);
  return store;
}

/**
 * Remove an entire target entry from memory.
 */
export async function removeTargetEntry(
  tenantId: string,
  targetKey: string
): Promise<MappingMemoryStore> {
  const store = await loadMappingMemory(tenantId);
  store.entries = store.entries.filter((e) => e.targetKey !== targetKey);
  await persistMappingMemory(store);
  return store;
}

/**
 * Normalize a label for comparison: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Compute a simple word-overlap similarity score between two strings.
 * Returns 0..1 where 1 = identical words.
 */
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(/[\s\-_:,./]+/).filter(Boolean));
  const wordsB = new Set(normalize(b).split(/[\s\-_:,./]+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/**
 * Match a label against a memory entry's known labels.
 * Returns a confidence score (0..1), 0 = no match.
 *
 * Matching strategy:
 *   1. Exact match (normalized) → 1.0
 *   2. Contains / is contained → 0.85
 *   3. Word overlap ≥ 60% → scaled 0.5..0.8
 */
function matchScore(fieldLabel: string, entry: MappingMemoryEntry): number {
  const normalizedField = normalize(fieldLabel);
  let bestScore = 0;

  for (const known of entry.sourceLabels) {
    // Exact match
    if (normalizedField === known) return 1.0;

    // Contains match (one contains the other)
    if (normalizedField.includes(known) || known.includes(normalizedField)) {
      bestScore = Math.max(bestScore, 0.85);
      continue;
    }

    // Word overlap
    const sim = wordSimilarity(normalizedField, known);
    if (sim >= 0.6) {
      bestScore = Math.max(bestScore, 0.5 + sim * 0.3);
    }
  }

  return bestScore;
}

/**
 * Auto-apply mapping memory to a new file's fields.
 * Returns matching rows sorted by confidence, with no duplicate targets.
 */
export function autoApplyFromMemory(
  store: MappingMemoryStore,
  extractedFields: Array<{ id: string; label: string; value: string }>
): Array<{
  sourceKey: string;
  sourceLabel: string;
  sourceType: "field" | "table";
  targetKey: string;
  targetType: "field" | "table";
  confidence: number;
}> {
  if (store.entries.length === 0 || extractedFields.length === 0) return [];

  // For each field, find the best matching memory entry
  const candidates: Array<{
    sourceKey: string;
    sourceLabel: string;
    sourceType: "field" | "table";
    targetKey: string;
    targetType: "field" | "table";
    confidence: number;
    usageCount: number;
  }> = [];

  for (const field of extractedFields) {
    let bestMatch: typeof candidates[0] | null = null;

    for (const entry of store.entries) {
      const score = matchScore(field.label, entry);
      if (score < 0.5) continue;

      if (!bestMatch || score > bestMatch.confidence || 
          (score === bestMatch.confidence && entry.usageCount > bestMatch.usageCount)) {
        bestMatch = {
          sourceKey: field.id,
          sourceLabel: field.label,
          sourceType: entry.sourceLabels.some(l => l === normalize(field.label)) ? entry.targetType : "field",
          targetKey: entry.targetKey,
          targetType: entry.targetType,
          confidence: score,
          usageCount: entry.usageCount
        };
      }
    }

    if (bestMatch) {
      candidates.push(bestMatch);
    }
  }

  // Deduplicate: for each targetKey, keep the highest-confidence match
  const byTarget = new Map<string, typeof candidates[0]>();
  for (const c of candidates) {
    const existing = byTarget.get(c.targetKey);
    if (!existing || c.confidence > existing.confidence ||
        (c.confidence === existing.confidence && c.usageCount > existing.usageCount)) {
      byTarget.set(c.targetKey, c);
    }
  }

  return [...byTarget.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .map(({ usageCount: _, ...rest }) => rest);
}
