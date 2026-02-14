"use client";

import { useEffect, useMemo, useState } from "react";
import { OUTPUT_FIELDS } from "@documap/shared";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { SaaSShell } from "../../components/saas-shell";
import {
  generateOutput,
  getTenantId,
  listSavedMappings,
  listUploads,
  saveMapping,
  type SavedMappingRecord,
  type UploadReference
} from "../../lib/api";

type MappingRow = {
  id: string;
  sourceType: "field" | "table";
  sourceKey: string;
  targetType: "field" | "table";
  targetKey: string;
};

type OutputFormat = "pdf" | "excel" | "text";

function inferSourceType(value: string): "field" | "table" {
  const v = value.trim();
  return v.startsWith("[") || v.startsWith("{") ? "table" : "field";
}

function fileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function toTextOutput(output: { fields: Record<string, string>; tables: Record<string, string> }) {
  const lines: string[] = [];
  lines.push("Mapped Output");
  lines.push("");
  lines.push("Fields");
  for (const [key, value] of Object.entries(output.fields)) {
    lines.push(`${key}: ${value}`);
  }

  lines.push("");
  lines.push("Tables");
  for (const [key, value] of Object.entries(output.tables)) {
    lines.push(`${key}: ${value}`);
  }

  return lines.join("\n");
}

function downloadBlob(content: BlobPart, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadAsText(output: { fields: Record<string, string>; tables: Record<string, string> }, baseName: string) {
  downloadBlob(toTextOutput(output), `${baseName}.txt`, "text/plain;charset=utf-8");
}

function downloadAsPdf(output: { fields: Record<string, string>; tables: Record<string, string> }, baseName: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const writeLine = (line: string, fontSize = 11) => {
    doc.setFontSize(fontSize);
    const wrapped = doc.splitTextToSize(line, width - margin * 2) as string[];
    for (const w of wrapped) {
      if (y > height - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(w, margin, y);
      y += fontSize + 5;
    }
  };

  writeLine("Mapped Output", 16);
  y += 4;
  writeLine("Fields", 13);
  for (const [key, value] of Object.entries(output.fields)) {
    writeLine(`${key}: ${value}`);
  }

  y += 8;
  writeLine("Tables", 13);
  for (const [key, value] of Object.entries(output.tables)) {
    writeLine(`${key}: ${value}`);
  }

  doc.save(`${baseName}.pdf`);
}

function downloadAsExcel(output: { fields: Record<string, string>; tables: Record<string, string> }, baseName: string) {
  const workbook = XLSX.utils.book_new();

  const fieldRows = Object.entries(output.fields).map(([key, value]) => ({ key, value }));
  const tableRows = Object.entries(output.tables).map(([key, value]) => ({ key, value }));

  const fieldsSheet = XLSX.utils.json_to_sheet(fieldRows.length > 0 ? fieldRows : [{ key: "", value: "" }]);
  const tablesSheet = XLSX.utils.json_to_sheet(tableRows.length > 0 ? tableRows : [{ key: "", value: "" }]);

  XLSX.utils.book_append_sheet(workbook, fieldsSheet, "Fields");
  XLSX.utils.book_append_sheet(workbook, tablesSheet, "Tables");

  XLSX.writeFile(workbook, `${baseName}.xlsx`);
}

export default function MappingPage() {
  const [uploads, setUploads] = useState<UploadReference[]>([]);
  const [savedMappings, setSavedMappings] = useState<SavedMappingRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("pdf");
  const [mappingName, setMappingName] = useState("default-mapping");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [generatedJson, setGeneratedJson] = useState<string>("");

  const selectedFile = useMemo(
    () => uploads.find((u) => u.fileId === selectedFileId) || null,
    [uploads, selectedFileId]
  );

  const sourceOptions = useMemo(() => {
    if (!selectedFile) {
      return [];
    }
    return selectedFile.extractedFields.map((f) => ({
      key: f.id,
      label: f.label,
      value: f.value,
      sourceType: inferSourceType(f.value)
    }));
  }, [selectedFile]);

  useEffect(() => {
    async function load() {
      try {
        const [uploadResponse, mappingResponse] = await Promise.all([listUploads(), listSavedMappings()]);
        setUploads(uploadResponse.items);
        setSavedMappings(mappingResponse.items);
        if (uploadResponse.items.length > 0) {
          setSelectedFileId(uploadResponse.items[0].fileId);
          setMappingName(`mapping-${uploadResponse.items[0].fileName.replace(/\.[^.]+$/, "")}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load mappings data");
      }
    }
    load();
  }, []);

  useEffect(() => {
    const selected = uploads.find((u) => u.fileId === selectedFileId);
    if (!selected) {
      return;
    }

    if (!mappingName || mappingName === "default-mapping" || mappingName.startsWith("mapping-")) {
      setMappingName(`mapping-${selected.fileName.replace(/\.[^.]+$/, "")}`);
    }
  }, [selectedFileId, uploads]);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: `row_${Date.now()}_${prev.length + 1}`,
        sourceType: "field",
        sourceKey: "",
        targetType: "field",
        targetKey: ""
      }
    ]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, patch: Partial<MappingRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const generate = async () => {
    if (!selectedFileId) {
      setError("Select one source file first.");
      return;
    }

    const validRows = rows.filter((r) => r.sourceKey && r.targetKey);
    if (validRows.length === 0) {
      setError("Add at least one mapping row before generating output.");
      return;
    }

    try {
      const result = await generateOutput({
        fileId: selectedFileId,
        mappings: validRows.map((r) => ({
          sourceType: r.sourceType,
          sourceKey: r.sourceKey,
          targetType: r.targetType,
          targetKey: r.targetKey
        }))
      });

      const json = JSON.stringify(result.output, null, 2);
      setGeneratedJson(json);
      setMessage(`Output generated for ${result.sourceFileName} as ${outputFormat.toUpperCase()}`);
      setError(null);

      const baseName = fileBaseName(result.downloadFileName);
      if (outputFormat === "text") {
        downloadAsText(result.output, baseName);
      } else if (outputFormat === "excel") {
        downloadAsExcel(result.output, baseName);
      } else {
        downloadAsPdf(result.output, baseName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate output file");
      setMessage(null);
    }
  };

  const saveCurrentMapping = async () => {
    if (!selectedFileId) {
      setError("Select one source file first.");
      return;
    }

    const validRows = rows.filter((r) => r.sourceKey && r.targetKey);
    if (validRows.length === 0) {
      setError("Add at least one mapping row before saving mapping JSON.");
      return;
    }

    if (!mappingName.trim()) {
      setError("Enter mapping name.");
      return;
    }

    try {
      await saveMapping({
        name: mappingName.trim(),
        fileId: selectedFileId,
        outputFormat,
        mappings: validRows.map((r) => ({
          sourceType: r.sourceType,
          sourceKey: r.sourceKey,
          targetType: r.targetType,
          targetKey: r.targetKey
        }))
      });

      const response = await listSavedMappings();
      setSavedMappings(response.items);
      setMessage(`Mapping saved to mappings folder as JSON: ${mappingName.trim()}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save mapping JSON");
      setMessage(null);
    }
  };

  return (
    <SaaSShell
      title="Mapping Canvas (Pass 1: One Source File)"
      subtitle="Add only the mappings you need. One source field maps to one output field."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-300">{error}</div> : null}
      {message ? <div className="card mb-4 p-3 text-sm text-emerald-300">{message}</div> : null}

      <section className="card mb-4 p-4">
        <p className="text-sm text-amber-300">
          Note: source file name must follow <strong>Source1_&lt;filename&gt;</strong> format.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs text-slate-400">Select source file</span>
            <select
              value={selectedFileId}
              onChange={(e) => setSelectedFileId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              <option value="">Select</option>
              {uploads.map((u) => (
                <option key={u.fileId} value={u.fileId}>
                  {u.fileName}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm text-slate-300">
            <p className="text-xs text-slate-400">Detected fields available</p>
            <p className="mt-1 text-xl font-semibold">{sourceOptions.length}</p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-white">Mapping Canvas</h2>
          <button
            type="button"
            onClick={addRow}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-100"
          >
            Add Mapping Row
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const filteredSources = sourceOptions.filter((s) => s.sourceType === row.sourceType);
            return (
              <div key={row.id} className="grid gap-2 rounded-lg border border-slate-800 p-3 md:grid-cols-6">
                <select
                  value={row.sourceType}
                  onChange={(e) => updateRow(row.id, { sourceType: e.target.value as "field" | "table", sourceKey: "" })}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100"
                >
                  <option value="field">Source Field</option>
                  <option value="table">Source Table</option>
                </select>

                <select
                  value={row.sourceKey}
                  onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 md:col-span-2"
                >
                  <option value="">Select source</option>
                  {filteredSources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <select
                  value={row.targetType}
                  onChange={(e) => updateRow(row.id, { targetType: e.target.value as "field" | "table", targetKey: "" })}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100"
                >
                  <option value="field">Target Field</option>
                  <option value="table">Target Table</option>
                </select>

                {row.targetType === "field" ? (
                  <select
                    value={row.targetKey}
                    onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 md:col-span-2"
                  >
                    <option value="">Select output field</option>
                    {OUTPUT_FIELDS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={row.targetKey}
                    onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    placeholder="Target table name"
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 md:col-span-2"
                  />
                )}

                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="rounded-md border border-slate-700 px-2 py-2 text-xs text-slate-200 md:col-span-6"
                >
                  Remove Row
                </button>
              </div>
            );
          })}

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">No mapping rows yet. Click “Add Mapping Row”.</p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-xs text-slate-400">Mapping name</span>
            <input
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              placeholder="e.g. mapping-audit-report"
              className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>

          <label className="text-sm">
            <span className="text-xs text-slate-400">Output format</span>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
              className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="pdf">PDF (.pdf)</option>
              <option value="excel">Excel (.xlsx)</option>
              <option value="text">Text (.txt)</option>
            </select>
          </label>

          <button
            type="button"
            onClick={generate}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            Generate Output File
          </button>

          <button
            type="button"
            onClick={saveCurrentMapping}
            className="rounded-md border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-300"
          >
            Save Mapping JSON
          </button>
        </div>
      </section>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-white">Saved Mappings (mappings folder)</h2>
        {savedMappings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No saved mappings yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {savedMappings.slice(0, 12).map((m) => (
              <div key={m.id} className="rounded border border-slate-800 px-3 py-2 text-sm text-slate-200">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-slate-400">
                  {m.fileNameOnDisk} • {m.fileName} • {m.outputFormat.toUpperCase()} • {new Date(m.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-white">Generated Output (Preview)</h2>
        <pre className="mt-3 max-h-72 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-200">
          {generatedJson || "Output preview appears here after generation."}
        </pre>
      </section>
    </SaaSShell>
  );
}
