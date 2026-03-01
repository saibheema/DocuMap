"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { listRecords, exportUrl } from "@/lib/dealers-api";
import { FINANCIAL_YEAR_OPTIONS, type DealerRecord } from "@documap/shared";

export default function RecordsPage() {
  const { getIdToken } = useAuth();
  const router = useRouter();

  const [records, setRecords] = useState<DealerRecord[]>([]);
  const [fy, setFy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(selectedFy: string) {
    setLoading(true);
    setError("");
    try {
      const token = await getIdToken();
      const data = await listRecords(token, selectedFy || undefined);
      setRecords(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(""); }, []);

  function handleFyChange(val: string) {
    setFy(val);
    load(val);
  }

  async function handleExport() {
    const token = await getIdToken();
    const url = exportUrl(fy || undefined);
    // Use fetch to get blob and trigger download
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { setError("Export failed."); return; }
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fy ? `dealer-records-${fy}.xlsx` : "dealer-records-all.xlsx";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function fmt(n: number): string {
    return new Intl.NumberFormat("en-IN").format(n);
  }

  return (
    <AuthGuard>
      <AppShell>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Dealer Records</h1>
            <p className="mt-1 text-sm text-gray-500">All captured dealer financial records.</p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Excel
          </button>
        </div>

        {/* FY filter */}
        <div className="mb-4 flex items-center gap-3">
          <label className="text-xs font-medium text-gray-600">Filter by FY:</label>
          <select
            value={fy}
            onChange={(e) => handleFyChange(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            <option value="">All years</option>
            {FINANCIAL_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="text-xs text-gray-400">{records.length} record{records.length !== 1 ? "s" : ""}</span>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-16 text-center">
            <p className="text-sm text-gray-400">No records found.</p>
            <button
              onClick={() => router.push("/lookup")}
              className="mt-3 text-sm text-blue-600 underline"
            >
              Add a new record →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Dealer Code</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">FY</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Turnover</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">PBIT</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Quality</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => (
                  <tr
                    key={`${r.dealerCode}-${r.financialYear}`}
                    className="cursor-pointer hover:bg-blue-50 transition-colors"
                    onClick={() =>
                      router.push(`/review?dealer=${encodeURIComponent(r.dealerCode)}&fy=${encodeURIComponent(r.financialYear)}`)
                    }
                  >
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">{r.dealerCode}</td>
                    <td className="px-4 py-3 text-gray-600">{r.financialYear}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{fmt(r.dealer_turnover)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{fmt(r.pbit)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        r.dealer_quality === "Excellent" ? "bg-green-100 text-green-700"
                        : r.dealer_quality === "Good" ? "bg-blue-100 text-blue-700"
                        : r.dealer_quality === "Medium" ? "bg-yellow-100 text-yellow-700"
                        : "bg-red-100 text-red-700"
                      }`}>
                        {r.dealer_quality}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <svg className="h-4 w-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
