"use client";

import { useEffect, useState } from "react";
import { SaaSShell } from "../../components/saas-shell";
import {
  getTenantId,
  listJobs,
  processUploadReference,
  updateJobStatus,
  type JobRecord
} from "../../lib/api";

function statusClass(status: string) {
  if (status === "completed") return "text-emerald-600";
  if (status === "failed") return "text-rose-600";
  if (status === "processing") return "text-blue-600";
  return "text-gray-600";
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await listJobs();
      setJobs(response.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: JobRecord["status"]) => {
    try {
      await updateJobStatus(id, status);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update job status");
    }
  };

  const runJob = async (fileId: string) => {
    try {
      await processUploadReference(fileId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run job processing");
    }
  };

  return (
    <SaaSShell
      title="Jobs"
      subtitle="Track document extraction and mapping progress."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-600">{error}</div> : null}

      <section className="card overflow-hidden">
        <div className="grid grid-cols-4 border-b border-gray-200 px-5 py-3 text-xs uppercase tracking-wide text-gray-500">
          <span>Job</span>
          <span>File</span>
          <span>Status</span>
          <span>Template</span>
        </div>
        <div className="divide-y divide-gray-200">
          {jobs.map((j) => (
            <div key={j.id} className="grid grid-cols-4 px-5 py-4 text-sm">
              <span className="text-gray-900">{j.id}</span>
              <span className="text-gray-600">{j.fileId}</span>
              <span className={statusClass(j.status)}>{j.status}</span>
              <div className="flex items-center gap-2 text-gray-600">
                <span>{j.templateId || "Auto Detect"}</span>
                <button
                  type="button"
                  onClick={() => runJob(j.fileId)}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs"
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(j.id, "completed")}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs"
                >
                  Complete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </SaaSShell>
  );
}
