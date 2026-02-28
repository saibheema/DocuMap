"use client";

import { useEffect, useMemo, useState } from "react";
import { OUTPUT_FIELDS } from "@documap/shared";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { SaaSShell } from "../../components/saas-shell";
import {
  autoApplyMappings,
  generateOutput,
  getTenantId,
  learnMappings,
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
  autoApplied?: boolean;
};

type OutputFormat = "pdf" | "excel" | "text" | "csv";
type OutputMode = "new" | "append";

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

function downloadAsCsv(
  output: { fields: Record<string, string>; tables: Record<string, string> },
  baseName: string,
  fileName: string,
  mode: OutputMode
) {
  // Create CSV row with all field values
  const headers = Object.keys(output.fields);
  const values = Object.values(output.fields);
  
  let csvContent = "";
  
  if (mode === "new") {
    // New file: include headers and data
    csvContent = `file_name,${headers.join(",")}\n`;
    csvContent += `${fileName},${values.join(",")}\n`;
  } else {
    // Append mode: only data row (user should ensure headers match)
    csvContent = `${fileName},${values.join(",")}\n`;
  }
  
  downloadBlob(csvContent, `${baseName}.csv`, "text/csv;charset=utf-8");
}

export default function MappingPage() {
  const [uploads, setUploads] = useState<UploadReference[]>([]);
  const [savedMappings, setSavedMappings] = useState<SavedMappingRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("csv");
  const [outputMode, setOutputMode] = useState<OutputMode>("new");
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

    // Auto-apply saved mappings from memory based on field labels
    autoApplyMappings(selected.extractedFields).then((autoRows) => {
      if (autoRows.length > 0) {
        setRows(autoRows);
        setMessage(`Auto-applied ${autoRows.length} mapping(s) from memory. Review and adjust as needed.`);
      } else {
        setRows([]);
      }
    }).catch(() => {
      setRows([]);
    });
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
      setMessage(`Output generated for ${result.sourceFileName} as ${outputFormat.toUpperCase()} (${outputMode === "append" ? "append mode" : "new file"})`);
      setError(null);

      const baseName = fileBaseName(result.downloadFileName);
      if (outputFormat === "csv") {
        downloadAsCsv(result.output, baseName, result.sourceFileName, outputMode);
      } else if (outputFormat === "text") {
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

      // Learn these mappings into memory for auto-apply on future files
      const currentFile = uploads.find((u) => u.fileId === selectedFileId);
      if (currentFile) {
        await learnMappings(validRows, currentFile.extractedFields);
      }

      const response = await listSavedMappings();
      setSavedMappings(response.items);
      setMessage(`Mapping saved and learned for auto-apply on future files: ${mappingName.trim()}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save mapping JSON");
      setMessage(null);
    }
  };

  return (
    <SaaSShell
      title="Mapping Studio"
      subtitle="Map extracted source fields to your target output schema."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-600">{error}</div> : null}
      {message ? <div className="card mb-4 p-3 text-sm text-emerald-600">{message}</div> : null}

      <section className="card mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs text-gray-500">Select source file</span>
            <select
              value={selectedFileId}
              onChange={(e) => setSelectedFileId(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-900"
            >
              <option value="">Select</option>
              {uploads.map((u) => (
                <option key={u.fileId} value={u.fileId}>
                  {u.fileName}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm text-gray-600">
            <p className="text-xs text-gray-500">Detected fields available</p>
            <p className="mt-1 text-xl font-semibold">{sourceOptions.length}</p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Mapping Canvas</h2>
          <button
            type="button"
            onClick={addRow}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-900"
          >
            Add Mapping Row
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const filteredSources = sourceOptions.filter((s) => s.sourceType === row.sourceType);
            return (
              <div key={row.id} className="grid gap-2 rounded-lg border border-gray-200 p-3 md:grid-cols-6">
                {row.autoApplied && (
                  <div className="md:col-span-6 text-xs text-emerald-600 font-medium">✓ Auto-applied from mapping memory</div>
                )}
                <select
                  value={row.sourceType}
                  onChange={(e) => updateRow(row.id, { sourceType: e.target.value as "field" | "table", sourceKey: "" })}
                  className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900"
                >
                  <option value="field">Source Field</option>
                  <option value="table">Source Table</option>
                </select>

                <select
                  value={row.sourceKey}
                  onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                  className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 md:col-span-2"
                >
                  <option value="">Select source</option>
                  {filteredSources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} → {s.value.length > 60 ? s.value.slice(0, 60) + "…" : s.value}
                    </option>
                  ))}
                </select>

                <select
                  value={row.targetType}
                  onChange={(e) => updateRow(row.id, { targetType: e.target.value as "field" | "table", targetKey: "" })}
                  className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900"
                >
                  <option value="field">Target Field</option>
                  <option value="table">Target Table</option>
                </select>

                {row.targetType === "field" ? (
                  <select
                    value={row.targetKey}
                    onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 md:col-span-2"
                  >
                    <option value="">Select output field</option>
                    {OUTPUT_FIELDS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__custom">— Custom field name —</option>
                  </select>
                ) : (
                  <input
                    value={row.targetKey}
                    onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    placeholder="Target table name"
                    className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 md:col-span-2"
                  />
                )}

                {row.targetType === "field" && row.targetKey === "__custom" && (
                  <input
                    value=""
                    onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    placeholder="Enter custom field name"
                    className="rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 md:col-span-6"
                    autoFocus
                  />
                )}

                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="rounded-md border border-gray-200 px-2 py-2 text-xs text-gray-700 md:col-span-6"
                >
                  Remove Row
                </button>
              </div>
            );
          })}

          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">No mapping rows yet. Click "Add Mapping Row".</p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-xs text-gray-500">Mapping name</span>
            <input
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              placeholder="e.g. mapping-audit-report"
              className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </label>

          <label className="text-sm">
            <span className="text-xs text-gray-500">Output format</span>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
              className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="csv">CSV (.csv)</option>
              <option value="excel">Excel (.xlsx)</option>
              <option value="pdf">PDF (.pdf)</option>
              <option value="text">Text (.txt)</option>
            </select>
          </label>

          {outputFormat === "csv" && (
            <label className="text-sm">
            <span className="text-xs text-gray-500">CSV mode</span>
            <select
              value={outputMode}
              onChange={(e) => setOutputMode(e.target.value as OutputMode)}
              className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="new">New file (with headers)</option>
                <option value="append">Append row (no headers)</option>
              </select>
            </label>
          )}

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
            className="rounded-md border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-600"
          >
            Save Mapping JSON
          </button>
        </div>
      </section>

      {/* Extracted Fields Preview */}
      {selectedFile && sourceOptions.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="font-semibold text-gray-900">Extracted Fields ({sourceOptions.length})</h2>
          <p className="mt-1 text-xs text-gray-500">All fields detected from the uploaded PDF. Use these as source fields in the mapping above.</p>
          <div className="mt-3 max-h-80 overflow-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-gray-500">ID</th>
                  <th className="px-3 py-2 text-left text-xs text-gray-500">Label</th>
                  <th className="px-3 py-2 text-left text-xs text-gray-500">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sourceOptions.map((s) => (
                  <tr key={s.key}>
                    <td className="px-3 py-1.5 text-xs text-gray-400 font-mono">{s.key}</td>
                    <td className="px-3 py-1.5 text-gray-700">{s.label}</td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-xs truncate" title={s.value}>{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-gray-900">Saved Mappings</h2>
        {savedMappings.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No saved mappings yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {savedMappings.slice(0, 12).map((m) => (
              <div key={m.id} className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-gray-500">
                  {m.fileNameOnDisk} • {m.fileName} • {m.outputFormat.toUpperCase()} • {new Date(m.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-gray-900">Output Preview</h2>
        <pre className="mt-3 max-h-72 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">
          {generatedJson || "Output preview appears here after generation."}
        </pre>
      </section>
    </SaaSShell>
  );
}
