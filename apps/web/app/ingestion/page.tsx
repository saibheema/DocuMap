"use client";

import { useEffect, useState } from "react";
import { SaaSShell } from "../../components/saas-shell";
import {
  createUploadReference,
  getTenantId,
  listUploads,
  processUploadReference,
  uploadSourcePdf,
  type UploadReference
} from "../../lib/api";
import { extractFieldsFromPdfInBrowser } from "../../lib/pdf-client-extractor";

export default function IngestionPage() {
  const [items, setItems] = useState<UploadReference[]>([]);
  const [fileName, setFileName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [extractedFieldsJson, setExtractedFieldsJson] = useState("[]");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const load = async () => {
    try {
      const response = await listUploads();
      setItems(response.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load upload references");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addRef = async () => {
    if (!fileName.trim() || (!sourcePath.trim() && !selectedPdf)) {
      return;
    }
    if (!/^Source1_.+/.test(fileName)) {
      setError("fileName must follow Source1_<filename> format.");
      return;
    }

    let extractedFields: Array<{ label: string; value: string; confidence?: number }> = [];
    try {
      const parsed = JSON.parse(extractedFieldsJson) as unknown;
      if (Array.isArray(parsed)) {
        extractedFields = parsed
          .filter((x): x is { label: string; value: string; confidence?: number } => {
            return (
              typeof x === "object" &&
              x !== null &&
              "label" in x &&
              "value" in x &&
              typeof (x as { label: unknown }).label === "string" &&
              typeof (x as { value: unknown }).value === "string"
            );
          })
          .map((x) => ({
            label: x.label,
            value: x.value,
            confidence: typeof x.confidence === "number" ? x.confidence : undefined
          }));
      }
    } catch {
      setError("Extracted fields JSON must be a valid array.");
      return;
    }

    try {
      if (selectedPdf) {
        setIsExtracting(true);
        try {
          const extractionResult = await extractFieldsFromPdfInBrowser(selectedPdf);
          const browserExtracted = extractionResult.fields.map((f, index) => ({
            id: f.id || `ef_${index + 1}`,
            label: f.label,
            value: f.value,
            confidence: f.confidence
          }));

          if (browserExtracted.length > 0) {
            await createUploadReference({
              fileName,
              sourcePath: sourcePath || `browser-upload://${selectedPdf.name}`,
              outputPath: outputPath || undefined,
              extractedFields: browserExtracted
            });

            setInfo(
              `Extracted ${browserExtracted.length} fields in browser using ${
                extractionResult.method === "ocr" ? "OCR" : "PDF text"
              }.`
            );
          } else {
            const uploaded = await uploadSourcePdf(selectedPdf, outputPath || undefined);
            setInfo(
              uploaded.extractedFieldCount > 0
                ? `Extracted ${uploaded.extractedFieldCount} fields using server upload processing.`
                : "No fields detected automatically. Add fields manually in JSON or use OCR-enabled backend."
            );
          }
        } catch {
          const uploaded = await uploadSourcePdf(selectedPdf, outputPath || undefined);
          setInfo(
            uploaded.extractedFieldCount > 0
              ? `Extracted ${uploaded.extractedFieldCount} fields using server upload processing.`
              : "Browser extraction failed. Uploaded file to server, but no fields detected."
          );
        }
      } else {
        await createUploadReference({
          fileName,
          sourcePath,
          outputPath: outputPath || undefined,
          extractedFields
        });
      }
      setFileName("");
      setSourcePath("");
      setOutputPath("");
      setSelectedPdf(null);
      setExtractedFieldsJson("[]");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create upload reference");
      setInfo(null);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <SaaSShell
      title="Reference Ingestion"
      subtitle="Register source file references from client folders without uploading binary documents."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-300">{error}</div> : null}
      {info ? <div className="card mb-4 p-3 text-sm text-emerald-300">{info}</div> : null}

      <section className="card p-5">
        <p className="mb-3 text-sm text-amber-300">
          Source file naming rule: <strong>Source1_&lt;filename&gt;</strong>
        </p>
        <h2 className="font-semibold text-white">Create Ingestion Reference</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="text-xs text-slate-400">Or choose local file to auto-fill file name</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFileName(f.name);
                  setSelectedPdf(f);
                  setSourcePath(`browser-upload://${f.name}`);
                }
              }}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="File name (Source1_<filename>)"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder="Source path (client network)"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="Output path (optional)"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 md:col-span-2"
          />
          <textarea
            value={extractedFieldsJson}
            onChange={(e) => setExtractedFieldsJson(e.target.value)}
            placeholder='Extracted fields JSON array, e.g. [{"label":"Owners Capital","value":"125000"}]'
            className="min-h-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 md:col-span-2"
          />
        </div>
        <button
          type="button"
          onClick={addRef}
          disabled={isExtracting}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          {isExtracting ? "Extracting..." : "Add Reference"}
        </button>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="grid grid-cols-5 border-b border-slate-800 px-5 py-3 text-xs uppercase tracking-wide text-slate-400">
          <span>File</span>
          <span>Source Path</span>
          <span>Output Path</span>
          <span>Status</span>
          <span>Action</span>
        </div>
        <div className="divide-y divide-slate-800">
          {items.map((item) => (
            <div key={item.fileId} className="grid grid-cols-5 gap-3 px-5 py-4 text-sm">
              <span className="text-slate-100">{item.fileName}</span>
              <span className="truncate text-slate-300" title={item.sourcePath}>
                {item.sourcePath}
              </span>
              <span className="truncate text-slate-300" title={item.outputPath || "Not set"}>
                {item.outputPath || "Not set"}
              </span>
              <span className="text-blue-300">{item.status}</span>
              <div>
                {item.status === "queued" ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await processUploadReference(item.fileId);
                        await load();
                        setError(null);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Failed to process upload reference");
                      }
                    }}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-100"
                  >
                    Process
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">-</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </SaaSShell>
  );
}
