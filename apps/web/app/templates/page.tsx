"use client";

import { useEffect, useState } from "react";
import { SaaSShell } from "../../components/saas-shell";
import {
  cloneTemplate,
  createTemplate,
  deactivateTemplate,
  downloadTemplateMappingsFile,
  getTenantId,
  importTemplateMappingsFile,
  listTemplates,
  type TemplateRecord
} from "../../lib/api";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [name, setName] = useState("");
  const [filenamePattern, setFilenamePattern] = useState("");
  const [textContains, setTextContains] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await listTemplates();
      setTemplates(response.items);
      setError(null);
      setMessage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async () => {
    if (!name.trim()) {
      return;
    }

    try {
      await createTemplate({
        name,
        detectionRule: {
          filenamePattern: filenamePattern || undefined,
          textContains: textContains || undefined
        },
        mappings: []
      });

      setName("");
      setFilenamePattern("");
      setTextContains("");
      setMessage("Template created.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template");
    }
  };

  const onClone = async (id: string) => {
    try {
      await cloneTemplate(id);
      setMessage("Template cloned.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clone template");
    }
  };

  const onDeactivate = async (id: string) => {
    try {
      await deactivateTemplate(id);
      setMessage("Template deactivated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deactivate template");
    }
  };

  const onDownload = async () => {
    try {
      const blob = await downloadTemplateMappingsFile();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `documap-mappings-${getTenantId()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage("Mapping file downloaded.");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download mapping file");
    }
  };

  const onImport = async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { templates?: unknown };

      if (!Array.isArray(parsed.templates)) {
        throw new Error("Invalid mapping file: templates array missing.");
      }

      await importTemplateMappingsFile({
        mode: "replace",
        templates: parsed.templates as Array<{
          id?: string;
          name: string;
          active?: boolean;
          createdAt?: string;
          detectionRule?: { filenamePattern?: string; textContains?: string };
          mappings?: Array<{ sourceField: string; outputField: string; transform?: string }>;
        }>
      });

      setMessage("Mapping file imported (replace mode).");
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import mapping file");
    }
  };

  return (
    <SaaSShell
      title="Template Library"
      subtitle="Maintain source-specific mapping templates for each corporate format."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-300">{error}</div> : null}
      {message ? <div className="card mb-4 p-3 text-sm text-emerald-300">{message}</div> : null}

      <section className="card mb-6 p-5">
        <h2 className="font-semibold text-white">Mapping File Backup</h2>
        <p className="mt-2 text-sm text-slate-300">
          Download mappings as JSON and upload the file after restart to restore templates.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onDownload}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-100"
          >
            Download Mapping File
          </button>
          <label className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-100">
            Upload Mapping File
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => onImport(e.target.files?.[0] || null)}
            />
          </label>
        </div>
      </section>

      <section className="card mb-6 p-5">
        <h2 className="font-semibold text-white">Create Template</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={filenamePattern}
            onChange={(e) => setFilenamePattern(e.target.value)}
            placeholder="Filename pattern (optional)"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={textContains}
            onChange={(e) => setTextContains(e.target.value)}
            placeholder="Text contains (optional)"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Create Template
        </button>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold text-white">Saved Templates</h2>
        </div>
        <div className="divide-y divide-slate-800">
          {templates.map((t) => (
            <div key={t.name} className="grid gap-3 px-5 py-4 md:grid-cols-4 md:items-center">
              <div>
                <p className="font-medium text-white">{t.name}</p>
                <p className="text-xs text-slate-400">
                  {t.detectionRule.filenamePattern || t.detectionRule.textContains || "No rule"}
                </p>
              </div>
              <p className="text-sm text-slate-300">Mappings: {t.mappings.length}</p>
              <p className="text-sm text-slate-300">Status: {t.active ? "Active" : "Inactive"}</p>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                >
                  View
                </button>
                <button
                  onClick={() => onClone(t.id)}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                >
                  Clone
                </button>
                <button
                  onClick={() => onDeactivate(t.id)}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                >
                  {t.active ? "Deactivate" : "Inactive"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </SaaSShell>
  );
}
