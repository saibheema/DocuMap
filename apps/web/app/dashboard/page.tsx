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
          { label: "Documents", value: String(summary.metrics.uploads) },
          { label: "Jobs", value: String(summary.metrics.jobs) },
          { label: "Templates", value: String(summary.metrics.templates) },
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
      title="Dashboard"
      subtitle="Overview of your document processing activity."
      workspaceLabel={getTenantId()}
    >
      {error ? (
        <div className="card mb-4 p-4 text-sm text-rose-600">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="card p-4">
            <p className="text-xs text-gray-500">{m.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4">
        <section className="card p-5">
          <h2 className="font-semibold text-gray-900">Quick Actions</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              href="/ingestion"
              className="rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white"
            >
              Upload Document
            </Link>
            <Link
              href="/mapping"
              className="rounded-lg border border-gray-200 px-4 py-3 text-center text-sm text-gray-700"
            >
              Open Mapping Studio
            </Link>
            <Link
              href="/templates"
              className="rounded-lg border border-gray-200 px-4 py-3 text-center text-sm text-gray-700"
            >
              Manage Templates
            </Link>
            <Link
              href="/jobs"
              className="rounded-lg border border-gray-200 px-4 py-3 text-center text-sm text-gray-700"
            >
              View Jobs
            </Link>
          </div>
        </section>
      </div>

    </SaaSShell>
  );
}
