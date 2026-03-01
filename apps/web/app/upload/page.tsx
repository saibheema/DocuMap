"use client";


import { useRef, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { extractFromPdf, saveRecord } from "@/lib/dealers-api";
import { OUTPUT_FIELDS, DEALER_QUALITY_OPTIONS, type OutputFieldKey, type DealerQuality } from "@documap/shared";

type FieldValues = Partial<Record<OutputFieldKey, string>>;

function UploadContent() {
  const params = useSearchParams();
  const dealerCode = params.get("dealer") ?? "";
  const financialYear = params.get("fy") ?? "";
  const { getIdToken } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"idle" | "extracting" | "review" | "saving">("idle");
  const [fields, setFields] = useState<FieldValues>({});
  const [unmapped, setUnmapped] = useState<{ rawLabel: string; rawValue: string }[]>([]);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [note, setNote] = useState("");
  const [dealerQuality, setDealerQuality] = useState<DealerQuality>("Good");
  const [seasonalProbability, setSeasonalProbability] = useState("");
  const [error, setError] = useState("");
  const [geminiKey, setGeminiKey] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("documap:gemini-key") ?? "" : ""
  );

  function handleGeminiKeyChange(val: string) {
    setGeminiKey(val);
    if (typeof window !== "undefined") {
      if (val.trim()) localStorage.setItem("documap:gemini-key", val.trim());
      else localStorage.removeItem("documap:gemini-key");
    }
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setStep("idle");
    setFields({});
    setError("");
  }, []);

  async function handleExtract() {
    if (!file) return;
    setError("");
    setStep("extracting");
    try {
      const token = await getIdToken();
      const result = await extractFromPdf(token, file, financialYear, geminiKey);
      const strFields: FieldValues = {};
      for (const [k, v] of Object.entries(result.fields)) {
        strFields[k as OutputFieldKey] = String(v ?? "");
      }
      setFields(strFields);
      setUnmapped(result.unmappedFields);
      setConfidence(result.confidence);
      setNote(result.note);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed.");
      setStep("idle");
    }
  }

  async function handleSave() {
    setError("");
    setStep("saving");
    try {
      // Validate all 10 fields have values
      const missing = OUTPUT_FIELDS.filter((f) => !fields[f.key]);
      if (missing.length > 0) {
        setError(`Please fill in: ${missing.map((f) => f.label).join(", ")}`);
        setStep("review");
        return;
      }
      const token = await getIdToken();
      const numeric: Record<string, number> = {};
      for (const f of OUTPUT_FIELDS) {
        numeric[f.key] = parseFloat(String(fields[f.key] ?? "0").replace(/,/g, "")) || 0;
      }
      await saveRecord(token, {
        dealerCode,
        financialYear,
        ...numeric,
        dealer_quality: dealerQuality,
        seasonal_probability: seasonalProbability,
      } as any);
      router.push(`/review?dealer=${encodeURIComponent(dealerCode)}&fy=${encodeURIComponent(financialYear)}&saved=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.");
      setStep("review");
    }
  }

  const confidenceColor = confidence === "high" ? "text-green-600 bg-green-50" : confidence === "medium" ? "text-yellow-600 bg-yellow-50" : "text-red-600 bg-red-50";

  return (
    <AuthGuard>
      <AppShell>
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-gray-400">
            <span className="font-mono font-medium text-gray-700">{dealerCode}</span>
            {" · "}
            <span>{financialYear}</span>
          </p>
          <h1 className="mt-1 text-xl font-bold text-gray-900">Upload &amp; Extract</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload the dealer&apos;s audited financial PDF. The PDF is processed in memory only and never stored.
          </p>
        </div>

        {/* Step 1: File upload */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">1. Select PDF</h2>
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 py-8 transition hover:border-blue-400 hover:bg-blue-50"
            onClick={() => fileRef.current?.click()}
          >
            <svg className="mb-2 h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {file ? (
              <p className="text-sm font-medium text-blue-700">{file.name}</p>
            ) : (
              <p className="text-sm text-gray-500">Click or drag PDF here</p>
            )}
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
          </div>

          {/* Gemini API Key */}
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Gemini API Key
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-blue-500 underline"
              >
                Get a free key ↗
              </a>
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => handleGeminiKeyChange(e.target.value)}
              placeholder="AIza…"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-blue-500"
            />
            <p className="mt-0.5 text-xs text-gray-400">Saved to your browser only. Each user uses their own key.</p>
          </div>

          {file && step === "idle" && (
            <button
              onClick={handleExtract}
              disabled={!geminiKey.trim()}
              title={!geminiKey.trim() ? "Enter your Gemini API key above to extract" : undefined}
              className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Extract Fields with AI
            </button>
          )}

          {step === "extracting" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-blue-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              Extracting financial data with Gemini AI…
            </div>
          )}
        </div>

        {/* Step 2: Review fields */}
        {step === "review" || step === "saving" ? (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${confidenceColor}`}>
                {confidence?.toUpperCase()} confidence
              </span>
              <span className="text-xs text-gray-400">{note}</span>
            </div>

            {unmapped.length > 0 && (
              <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-xs font-medium text-yellow-700">
                  {unmapped.length} value{unmapped.length > 1 ? "s" : ""} could not be auto-mapped.
                  {" "}
                  <button
                    className="underline"
                    onClick={() =>
                      router.push(
                        `/mapping?dealer=${encodeURIComponent(dealerCode)}&fy=${encodeURIComponent(financialYear)}&data=${encodeURIComponent(JSON.stringify({ unmapped, fields }))}`
                      )
                    }
                  >
                    Assign them manually →
                  </button>
                </p>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-gray-800">2. Review &amp; Correct Values</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {OUTPUT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="mb-1 block text-xs font-medium text-gray-600">{f.label}</label>
                    <input
                      type="text"
                      value={fields[f.key] ?? ""}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Dealer Quality</label>
                  <select
                    value={dealerQuality}
                    onChange={(e) => setDealerQuality(e.target.value as DealerQuality)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                    placeholder="e.g. 60%"
                  />
                </div>
              </div>

              {error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
              )}

              <button
                onClick={handleSave}
                disabled={step === "saving"}
                className="mt-5 w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {step === "saving" ? "Saving…" : "Save to Firestore"}
              </button>
            </div>
          </>
        ) : null}
      </AppShell>
    </AuthGuard>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>}>
      <UploadContent />
    </Suspense>
  );
}
