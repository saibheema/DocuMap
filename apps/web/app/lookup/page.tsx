"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { lookupDealer } from "@/lib/dealers-api";
import { FINANCIAL_YEAR_OPTIONS } from "@documap/shared";

export default function LookupPage() {
  const { getIdToken } = useAuth();
  const router = useRouter();
  const [dealerCode, setDealerCode] = useState("");
  const [financialYear, setFinancialYear] = useState(FINANCIAL_YEAR_OPTIONS[FINANCIAL_YEAR_OPTIONS.length - 2]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = dealerCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const token = await getIdToken();
      const result = await lookupDealer(token, code, financialYear);
      if (result.found) {
        router.push(`/review?dealer=${encodeURIComponent(code)}&fy=${encodeURIComponent(financialYear)}`);
      } else {
        router.push(`/upload?dealer=${encodeURIComponent(code)}&fy=${encodeURIComponent(financialYear)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="mx-auto max-w-md">
          <h1 className="mb-1 text-2xl font-bold text-gray-900">Dealer Lookup</h1>
          <p className="mb-8 text-sm text-gray-500">
            Enter a dealer code and financial year to check for an existing record, or start a new upload.
          </p>

          <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="dealerCode">
                Dealer Code
              </label>
              <input
                id="dealerCode"
                type="text"
                required
                value={dealerCode}
                onChange={(e) => setDealerCode(e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. DLR-001"
              />
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fy">
                Financial Year
              </label>
              <select
                id="fy"
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {FINANCIAL_YEAR_OPTIONS.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Checking…" : "Continue"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            If a record exists you will be taken to Review. Otherwise you will be
            taken to Upload &amp; Extract.
          </p>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
