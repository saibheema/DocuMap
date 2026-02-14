"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SaaSShell } from "../../components/saas-shell";
import { getDashboardSummary, getTenantId } from "../../lib/api";

type Metric = { label: string; value: string };

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const summary = await getDashboardSummary();
        setMetrics([
          { label: "Tenant", value: summary.tenantId },
          { label: "Templates", value: String(summary.metrics.templates) },
          { label: "Uploads", value: String(summary.metrics.uploads) },
          { label: "Jobs", value: String(summary.metrics.jobs) },
          { label: "Source Connections", value: String(summary.metrics.sourceConnections) },
          { label: "Automation Rate", value: `${summary.metrics.automationRate}%` }
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
      }
    }
    load();
  }, []);

  return (
    <SaaSShell
      title="Corporate Operations Dashboard"
      subtitle="Track extraction and mapping performance across all entities."
      workspaceLabel={getTenantId()}
    >
      {error ? (
        <div className="card mb-4 p-4 text-sm text-rose-300">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="card p-4">
            <p className="text-xs text-slate-400">{m.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4">
        <section className="card p-5">
          <h2 className="font-semibold text-white">Quick Actions</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              href="/ingestion"
              className="rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white"
            >
              Add Ingestion Reference
            </Link>
            <Link
              href="/connections"
              className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm text-slate-200"
            >
              Manage Connections
            </Link>
            <Link
              href="/mapping"
              className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm text-slate-200"
            >
              Open Mapping Studio
            </Link>
            <Link
              href="/templates"
              className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm text-slate-200"
            >
              Manage Templates
            </Link>
            <Link
              href="/jobs"
              className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm text-slate-200"
            >
              View Job Queue
            </Link>
            <button className="rounded-lg border border-slate-700 px-4 py-3 text-center text-sm text-slate-200">
              Invite Corporate User
            </button>
          </div>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold text-white">Data Residency Policy</h2>
        <p className="mt-2 text-sm text-slate-300">
          Tenant documents stay in company network folders. DocuMap stores only mapping metadata,
          source/output references, and processing status.
        </p>
      </section>
    </SaaSShell>
  );
}
