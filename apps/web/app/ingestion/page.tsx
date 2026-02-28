"use client";

import { useEffect, useState } from "react";
import { SaaSShell } from "../../components/saas-shell";
import {
  createUploadReference,
  getTenantId,
  listUploads,
  uploadSourcePdf,
  type UploadReference
} from "../../lib/api";
import { extractFieldsFromPdfInBrowser } from "../../lib/pdf-client-extractor";
import { getGeminiApiKey, setGeminiApiKey } from "../../lib/ai-extractor";

export default function IngestionPage() {
  const [items, setItems] = useState<UploadReference[]>([]);
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  const isHostedWithoutApi =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    !process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    setApiKey(getGeminiApiKey());
  }, []);

  const load = async () => {
    try {
      const response = await listUploads();
      setItems(response.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load uploads");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpload = async () => {
    if (!selectedPdf) {
      setError("Please select a PDF file to upload.");
      return;
    }

    const fileName = selectedPdf.name;
    setError(null);
    setInfo(null);

    try {
      setIsExtracting(true);
      setProgressMsg("Starting extraction...");
      try {
        const extractionResult = await extractFieldsFromPdfInBrowser(selectedPdf, (msg) =>
          setProgressMsg(msg)
        );
        const browserExtracted = extractionResult.fields.map((f, index) => ({
          id: f.id || `ef_${index + 1}`,
          label: f.label,
          value: f.value,
          confidence: f.confidence
        }));

        if (browserExtracted.length > 0 || isHostedWithoutApi) {
          setProgressMsg("Saving extracted fields...");
          await createUploadReference({
            fileName,
            sourcePath: `browser-upload://${fileName}`,
            extractedFields: browserExtracted
          });

          if (browserExtracted.length > 0) {
            const methodLabel =
              extractionResult.method === "ai"
                ? "Gemini AI"
                : extractionResult.method === "ocr"
                ? "Tesseract.js OCR"
                : "PDF text";
            setInfo(
              `✅ Extracted ${browserExtracted.length} fields using ${methodLabel}.`
            );
          } else {
            setInfo("⚠️ Document saved but no fields were extracted. This PDF may be image-only, encrypted, or have unusual formatting. Try configuring a Gemini API key for AI-powered OCR extraction.");
          }
        } else {
          const uploaded = await uploadSourcePdf(selectedPdf);
          setInfo(
            uploaded.extractedFieldCount > 0
              ? `✅ Extracted ${uploaded.extractedFieldCount} fields via server processing.`
              : "Document uploaded. No fields detected — try configuring a Gemini API key for better results."
          );
        }
      } catch {
        const uploaded = await uploadSourcePdf(selectedPdf);
        setInfo(
          uploaded.extractedFieldCount > 0
            ? `✅ Extracted ${uploaded.extractedFieldCount} fields via server processing.`
            : "Document saved but no fields were detected. Configure a Gemini API key for AI-powered extraction."
        );
      }
      setSelectedPdf(null);
      // Reset the file input
      const fileInput = document.getElementById("pdf-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload document");
      setInfo(null);
    } finally {
      setIsExtracting(false);
      setProgressMsg(null);
    }
  };

  return (
    <SaaSShell
      title="Upload Documents"
      subtitle="Upload PDF documents for AI-powered field extraction."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-600">{error}</div> : null}
      {info ? <div className="card mb-4 p-3 text-sm text-emerald-600">{info}</div> : null}
      {progressMsg && isExtracting ? (
        <div className="card mb-4 p-3 text-sm text-sky-600">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {progressMsg}
          </div>
        </div>
      ) : null}

      {/* AI Configuration */}
      <section className="card mb-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">🤖 Gemini AI OCR</span>
            {apiKey ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
                Active — best for scanned PDFs
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                Not configured — using fallback OCR
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowApiKeyInput(!showApiKeyInput)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            {showApiKeyInput ? "Hide" : apiKey ? "Change Key" : "Configure"}
          </button>
        </div>
        {showApiKeyInput && (
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Google Gemini API key"
              className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
            />
            <button
              type="button"
              onClick={() => {
                setGeminiApiKey(apiKey);
                setShowApiKeyInput(false);
                setInfo(apiKey ? "✅ Gemini AI configured. OCR extraction active for all uploads." : "API key cleared.");
              }}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              Save
            </button>
          </div>
        )}
        {!apiKey && !showApiKeyInput && (
          <p className="mt-2 text-xs text-gray-400">
            Get a free API key from{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
              Google AI Studio
            </a>{" "}
            for high-quality OCR extraction from scanned or image-based PDFs using Gemini AI.
          </p>
        )}
      </section>

      {/* Upload Form */}
      <section className="card p-5">
        <h2 className="font-semibold text-gray-900">Select PDF Document</h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose a PDF file to upload. Fields will be extracted automatically{apiKey ? " using Gemini AI" : ""}.
        </p>
        <div className="mt-4">
          <input
            id="pdf-file-input"
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setSelectedPdf(f);
            }}
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
          />
        </div>
        {selectedPdf && (
          <p className="mt-2 text-sm text-gray-600">
            Selected: <strong className="text-gray-900">{selectedPdf.name}</strong> ({(selectedPdf.size / 1024).toFixed(1)} KB)
          </p>
        )}
        <button
          type="button"
          onClick={handleUpload}
          disabled={isExtracting || !selectedPdf}
          className="mt-4 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isExtracting ? "Extracting..." : "Upload & Extract"}
        </button>
      </section>

      {/* Upload History */}
      {items.length > 0 && (
        <section className="card mt-6 overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3">
            <h2 className="text-sm font-medium text-gray-900">Uploaded Documents</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {items.map((item) => (
              <div key={item.fileId} className="flex items-center justify-between px-5 py-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{item.fileName}</p>
                  <p className="text-xs text-gray-400">
                    {item.extractedFields.length} fields extracted • {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className={`ml-4 rounded-full px-2 py-0.5 text-xs ${
                  item.status === "mapped" ? "bg-emerald-50 text-emerald-600" :
                  item.status === "exported" ? "bg-blue-50 text-blue-600" :
                  "bg-gray-100 text-gray-500"
                }`}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </SaaSShell>
  );
}
