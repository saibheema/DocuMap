import type { DealerRecord, ComputedRatios, OutputFieldKey } from "@documap/shared";

const API_URL =
  typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:4000"
    : (process.env.NEXT_PUBLIC_API_URL ?? "");

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_URL) throw new Error("No backend API configured.");
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type LookupResult =
  | { found: false; dealerCode: string; financialYear: string }
  | { found: true; record: DealerRecord; ratios: ComputedRatios };

export type ExtractionResult = {
  fields: Partial<Record<OutputFieldKey, number>>;
  unmappedFields: { rawLabel: string; rawValue: string }[];
  confidence: "high" | "medium" | "low";
  note: string;
};

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function lookupDealer(
  token: string,
  dealerCode: string,
  financialYear: string
): Promise<LookupResult> {
  return apiFetch<LookupResult>("/dealers/lookup", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerCode, financialYear }),
  });
}

export async function extractFromPdf(
  token: string,
  file: File,
  financialYear: string
): Promise<ExtractionResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("financialYear", financialYear);
  return apiFetch<ExtractionResult>("/dealers/extract", token, {
    method: "POST",
    body: formData,
  });
}

export async function saveRecord(
  token: string,
  record: Omit<DealerRecord, "createdAt" | "updatedAt" | "createdBy" | "updatedBy">
): Promise<{ record: DealerRecord; ratios: ComputedRatios }> {
  return apiFetch("/dealers/save", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
}

export async function listRecords(
  token: string,
  fy?: string
): Promise<{ items: DealerRecord[]; count: number }> {
  const q = fy ? `?fy=${encodeURIComponent(fy)}` : "";
  return apiFetch(`/dealers${q}`, token);
}

export async function getRecord(
  token: string,
  dealerCode: string,
  financialYear: string
): Promise<{ record: DealerRecord; ratios: ComputedRatios }> {
  return apiFetch(
    `/dealers/${encodeURIComponent(dealerCode)}/records/${encodeURIComponent(financialYear)}`,
    token
  );
}

export function exportUrl(fy?: string): string {
  const q = fy ? `?fy=${encodeURIComponent(fy)}` : "";
  return `${API_URL}/dealers/export${q}`;
}
