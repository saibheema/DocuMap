"use client";


import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { getRecord, extractFromPdf, saveRecord } from "@/lib/dealers-api";
import { OUTPUT_FIELDS, computeRatios, DEALER_QUALITY_OPTIONS, type OutputFieldKey, type DealerQuality, type DealerRecord } from "@documap/shared";

type FieldDecision = "retain" | "replace";

function ReviewContent() {
  const params = useSearchParams();
  const dealerCode = params.get("dealer") ?? "";
  const financialYear = params.get("fy") ?? "";
  const justSaved = params.get("saved") === "1";
  const { getIdToken } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [record, setRecord] = useState<DealerRecord | null>(null);
  const [ratios, setRatios] = useState<ReturnType<typeof computeRatios> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadingRecord, setLoadingRecord] = useState(true);

  // New PDF extraction state
  const [newFields, setNewFields] = useState<Partial<Record<OutputFieldKey, number>> | null>(null);
  const [decisions, setDecisions] = useState<Record<OutputFieldKey, FieldDecision>>({} as any);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!dealerCode || !financialYear) return;
    (async () => {
      setLoadingRecord(true);
      try {
        const token = await getIdToken();
        const data = await getRecord(token, dealerCode, financialYear);
        setRecord(data.record);
        setRatios(data.ratios);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load record.");
      } finally {
        setLoadingRecord(false);
      }
    })();
  }, [dealerCode, financialYear]);

  async function handleNewPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setSaveError("");
    try {
      const token = await getIdToken();
      const result = await extractFromPdf(token, file, financialYear);
      setNewFields(result.fields);
      const initialDecisions: Record<OutputFieldKey, FieldDecision> = {} as any;
      OUTPUT_FIELDS.forEach((f) => { initialDecisions[f.key] = "replace"; });
      setDecisions(initialDecisions);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!record) return;
    setSaving(true);
    setSaveError("");
    try {
      const merged: Record<string, number> = {};
      OUTPUT_FIELDS.forEach((f) => {
        merged[f.key] =
          newFields && decisions[f.key] === "replace"
            ? (newFields[f.key] ?? record[f.key as OutputFieldKey] as number)
            : record[f.key as OutputFieldKey] as number;
      });
      const token = await getIdToken();
      const result = await saveRecord(token, {
        ...record,
        ...merged,
      } as any);
      setRecord(result.record);
      setRatios(result.ratios);
      setNewFields(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function fmt(n: number | null | undefined): string {
    if (n == null) return "—";
    return new Intl.NumberFormat("en-IN").format(n);
  }

  function fmtRatio(n: number | null | undefined, decimals = 2): string {
    if (n == null) return "—";
    return n.toFixed(decimals);
  }

  if (loadingRecord) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  if (loadError || !record) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-600">{loadError || "Record not found."}</p>
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
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400">
              <span className="font-mono font-medium text-gray-700">{dealerCode}</span>
              {" · "}{financialYear}
            </p>
            <h1 className="mt-1 text-xl font-bold text-gray-900">Review Record</h1>
            {justSaved && (
              <p className="mt-1 text-xs text-green-600">✓ Record saved successfully.</p>
            )}
          </div>
          <button
            onClick={() => router.push("/lookup")}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ← Lookup
          </button>
        </div>

        {/* Ratios */}
        {ratios && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {([
              ["Owner Capital %", fmtRatio(ratios.ownerCapitalPct) + "%"],
              ["Interest Coverage", fmtRatio(ratios.interestCoverageRatio) + "x"],
              ["DPO (days)", fmtRatio(ratios.dpo, 0)],
              ["DSO (days)", fmtRatio(ratios.dso, 0)],
              ["Current Ratio", fmtRatio(ratios.currentRatio)],
              ["Avg Sales (2yr)", ratios.averageSales != null ? fmt(ratios.averageSales) : "—"],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
                <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Field values */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Financial Figures</h2>
            <div>
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleNewPdf} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={extracting}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60"
              >
                {extracting ? "Extracting…" : "Compare new PDF"}
              </button>
            </div>
          </div>

          {/* Side-by-side comparison if new PDF uploaded */}
          {newFields ? (
            <div>
              <div className="mb-2 grid grid-cols-[1fr_1fr_1fr_80px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Field</span><span>Current</span><span>New PDF</span><span>Use</span>
              </div>
              {OUTPUT_FIELDS.map((f) => {
                const old = record[f.key as OutputFieldKey] as number;
                const newVal = newFields[f.key] ?? null;
                const changed = newVal != null && newVal !== old;
                return (
                  <div key={f.key} className={`grid grid-cols-[1fr_1fr_1fr_80px] gap-2 items-center rounded-lg px-2 py-1.5 text-sm ${changed ? "bg-yellow-50" : ""}`}>
                    <span className="text-xs font-medium text-gray-700">{f.label}</span>
                    <span className="font-mono text-gray-500">{fmt(old)}</span>
                    <span className={`font-mono ${changed ? "font-semibold text-orange-600" : "text-gray-400"}`}>
                      {newVal != null ? fmt(newVal) : "—"}
                    </span>
                    <select
                      value={decisions[f.key] ?? "retain"}
                      onChange={(e) => setDecisions((d) => ({ ...d, [f.key]: e.target.value as FieldDecision }))}
                      className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs"
                    >
                      <option value="retain">Retain</option>
                      <option value="replace">Replace</option>
                    </select>
                  </div>
                );
              })}

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => OUTPUT_FIELDS.forEach((f) => setDecisions((d) => ({ ...d, [f.key]: "replace" })))}
                  className="text-xs text-blue-600 underline"
                >
                  Replace all
                </button>
                <button
                  onClick={() => OUTPUT_FIELDS.forEach((f) => setDecisions((d) => ({ ...d, [f.key]: "retain" })))}
                  className="text-xs text-gray-500 underline"
                >
                  Retain all
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {OUTPUT_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-xs text-gray-500">{f.label}</span>
                  <span className="font-mono text-sm font-medium text-gray-900">
                    {fmt(record[f.key as OutputFieldKey] as number)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">Additional Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gray-500">Dealer Quality</p>
              <p className="mt-0.5 font-medium text-gray-900">{record.dealer_quality}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Seasonal Probability</p>
              <p className="mt-0.5 font-medium text-gray-900">{record.seasonal_probability || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Last Updated</p>
              <p className="mt-0.5 text-sm text-gray-700">
                {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "—"}
              </p>
            </div>
          </div>
        </div>

        {saveError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{saveError}</p>
        )}

        {newFields && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        )}
      </AppShell>
    </AuthGuard>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>}>
      <ReviewContent />
    </Suspense>
  );
}
