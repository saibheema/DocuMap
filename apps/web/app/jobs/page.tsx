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
  if (status === "completed") return "text-emerald-300";
  if (status === "failed") return "text-rose-300";
  if (status === "processing") return "text-blue-300";
  return "text-slate-300";
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
      title="Processing Jobs"
      subtitle="Observe extraction and mapping progress for each corporate submission."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-300">{error}</div> : null}

      <section className="card overflow-hidden">
        <div className="grid grid-cols-4 border-b border-slate-800 px-5 py-3 text-xs uppercase tracking-wide text-slate-400">
          <span>Job</span>
          <span>File</span>
          <span>Status</span>
          <span>Template</span>
        </div>
        <div className="divide-y divide-slate-800">
          {jobs.map((j) => (
            <div key={j.id} className="grid grid-cols-4 px-5 py-4 text-sm">
              <span className="text-slate-100">{j.id}</span>
              <span className="text-slate-300">{j.fileId}</span>
              <span className={statusClass(j.status)}>{j.status}</span>
              <div className="flex items-center gap-2 text-slate-300">
                <span>{j.templateId || "Auto Detect"}</span>
                <button
                  type="button"
                  onClick={() => runJob(j.fileId)}
                  className="rounded border border-slate-700 px-2 py-0.5 text-xs"
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(j.id, "completed")}
                  className="rounded border border-slate-700 px-2 py-0.5 text-xs"
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
