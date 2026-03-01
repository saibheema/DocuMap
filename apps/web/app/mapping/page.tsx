"use client";


import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { saveRecord } from "@/lib/dealers-api";
import { OUTPUT_FIELDS, DEALER_QUALITY_OPTIONS, type OutputFieldKey, type DealerQuality } from "@documap/shared";

type UnmappedField = { rawLabel: string; rawValue: string };
type Assignment = OutputFieldKey | "";

function MappingContent() {
  const params = useSearchParams();
  const dealerCode = params.get("dealer") ?? "";
  const financialYear = params.get("fy") ?? "";
  const { getIdToken } = useAuth();
  const router = useRouter();

  // Data comes from the upload page via query param
  const rawData = params.get("data");
  const parsed = rawData ? (() => { try { return JSON.parse(decodeURIComponent(rawData)); } catch { return null; } })() : null;
  const unmapped: UnmappedField[] = parsed?.unmapped ?? [];
  const autoFields: Partial<Record<OutputFieldKey, string>> = parsed?.fields ?? {};

  const [assignments, setAssignments] = useState<Assignment[]>(unmapped.map(() => ""));
  const [mergedFields, setMergedFields] = useState<Partial<Record<OutputFieldKey, string>>>(autoFields);
  const [dealerQuality, setDealerQuality] = useState<DealerQuality>("Good");
  const [seasonalProbability, setSeasonalProbability] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Merge an assignment into mergedFields
  function applyAssignment(idx: number, field: OutputFieldKey | "") {
    const updated = [...assignments];
    // Clear previous assignment for this row's field
    const prev = assignments[idx];
    if (prev) {
      setMergedFields((f) => {
        const copy = { ...f };
        // Only remove if it came from this unmapped row
        if (copy[prev] === unmapped[idx].rawValue) delete copy[prev];
        return copy;
      });
    }
    updated[idx] = field;
    setAssignments(updated);
    if (field) {
      setMergedFields((f) => ({ ...f, [field]: unmapped[idx].rawValue }));
    }
  }

  // Already-assigned fields (can't pick the same target twice)
  const assignedFields = new Set(assignments.filter(Boolean));

  async function handleSave() {
    setSaving(true);
    setError("");
    const missing = OUTPUT_FIELDS.filter((f) => !mergedFields[f.key]);
    if (missing.length > 0) {
      setError(`Missing fields: ${missing.map((f) => f.label).join(", ")}. Assign all unmapped values or go back and correct them.`);
      setSaving(false);
      return;
    }
    try {
      const token = await getIdToken();
      const numeric: Record<string, number> = {};
      OUTPUT_FIELDS.forEach((f) => {
        numeric[f.key] = parseFloat(String(mergedFields[f.key] ?? "0").replace(/,/g, "")) || 0;
      });
      await saveRecord(token, {
        dealerCode,
        financialYear,
        ...numeric,
        dealer_quality: dealerQuality,
        seasonal_probability: seasonalProbability,
      } as any);
      router.push(`/review?dealer=${encodeURIComponent(dealerCode)}&fy=${encodeURIComponent(financialYear)}&saved=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
      setSaving(false);
    }
  }

  if (unmapped.length === 0 && Object.keys(autoFields).length === 0) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
            <p className="text-sm text-gray-500">No unmatched fields. Please go back to the upload page.</p>
            <button onClick={() => router.push("/lookup")} className="mt-4 text-sm text-blue-600 underline">
              Back to Lookup
            </button>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <p className="text-xs text-gray-400">
            <span className="font-mono font-medium text-gray-700">{dealerCode}</span>
            {" · "}{financialYear}
          </p>
          <h1 className="mt-1 text-xl font-bold text-gray-900">Manual Field Assignment</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI could not confidently match these values to the 10 output fields. Assign each one using the dropdown.
          </p>
        </div>

        {/* Unmatched field assignments */}
        {unmapped.length > 0 && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">
              Unmatched Values ({unmapped.length})
            </h2>
            <div className="divide-y divide-gray-100">
              {unmapped.map((u, idx) => (
                <div key={idx} className="flex items-center gap-4 py-3">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500">{u.rawLabel}</p>
                    <p className="font-mono text-sm font-medium text-gray-900">{u.rawValue}</p>
                  </div>
                  <div className="flex-1">
                    <select
                      value={assignments[idx]}
                      onChange={(e) => applyAssignment(idx, e.target.value as OutputFieldKey | "")}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">— select target field —</option>
                      {OUTPUT_FIELDS.map((f) => (
                        <option
                          key={f.key}
                          value={f.key}
                          disabled={assignedFields.has(f.key) && assignments[idx] !== f.key}
                        >
                          {f.label}
                          {assignedFields.has(f.key) && assignments[idx] !== f.key ? " (taken)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary of all 10 fields */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">All 10 Fields (current state)</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {OUTPUT_FIELDS.map((f) => {
              const val = mergedFields[f.key];
              const hasValue = val != null && val !== "";
              return (
                <div
                  key={f.key}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${hasValue ? "bg-green-50" : "bg-red-50"}`}
                >
                  <span className="text-xs text-gray-600">{f.label}</span>
                  {hasValue ? (
                    <span className="font-mono text-sm font-medium text-gray-900">{val}</span>
                  ) : (
                    <span className="text-xs text-red-400">Missing</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Additional metadata */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">Additional Details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Dealer Quality</label>
              <select
                value={dealerQuality}
                onChange={(e) => setDealerQuality(e.target.value as DealerQuality)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none"
              >
                {DEALER_QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Seasonal Probability</label>
              <input
                type="text"
                value={seasonalProbability}
                onChange={(e) => setSeasonalProbability(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
                placeholder="e.g. 60%"
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => router.back()}
            className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            ← Back
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save to Firestore"}
          </button>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

export default function MappingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>}>
      <MappingContent />
    </Suspense>
  );
}
