// ─── Output field types ────────────────────────────────────────────────────

export type OutputFieldKey =
  | "owners_capital"
  | "total_liabilities"
  | "pbit"
  | "interest"
  | "accounts_payable"
  | "accounts_receivable"
  | "dealer_turnover"
  | "purchases"
  | "current_assets"
  | "current_liabilities";

export type OutputField = {
  key: OutputFieldKey;
  label: string;
  required: boolean;
  type: "number" | "string";
};

export const OUTPUT_FIELDS: OutputField[] = [
  { key: "owners_capital",       label: "Owners Capital",        required: true, type: "number" },
  { key: "total_liabilities",    label: "Total Liabilities",     required: true, type: "number" },
  { key: "pbit",                 label: "PBIT",                  required: true, type: "number" },
  { key: "interest",             label: "Interest",              required: true, type: "number" },
  { key: "accounts_payable",     label: "Accounts Payable",      required: true, type: "number" },
  { key: "accounts_receivable",  label: "Accounts Receivable",   required: true, type: "number" },
  { key: "dealer_turnover",      label: "Dealer Turnover",       required: true, type: "number" },
  { key: "purchases",            label: "Purchases",             required: true, type: "number" },
  { key: "current_assets",       label: "Current Assets",        required: true, type: "number" },
  { key: "current_liabilities",  label: "Current Liabilities",   required: true, type: "number" },
];

// ─── Dealer record ────────────────────────────────────────────────────────

export type DealerQuality = "Good" | "Medium" | "Excellent" | "Poor";

export type DealerRecord = {
  dealerCode: string;
  financialYear: string;
  owners_capital: number;
  total_liabilities: number;
  pbit: number;
  interest: number;
  accounts_payable: number;
  purchases: number;
  accounts_receivable: number;
  dealer_turnover: number;
  current_assets: number;
  current_liabilities: number;
  dealer_quality: DealerQuality;
  seasonal_probability: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────

export const FINANCIAL_YEAR_OPTIONS: string[] = [
  "2020-21",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
];

export const DEALER_QUALITY_OPTIONS: DealerQuality[] = [
  "Excellent",
  "Good",
  "Medium",
  "Poor",
];

// ─── Synonym map ──────────────────────────────────────────────────────────

export const SYNONYM_MAP: Record<OutputFieldKey, string[]> = {
  owners_capital: [
    "owners capital", "capital account", "partner capital", "proprietor capital",
    "proprietor's capital", "partners capital", "capital & reserves",
    "reserves & surplus", "shareholders funds", "networth", "net worth",
    "equity capital", "proprietors fund", "capital fund",
  ],
  total_liabilities: [
    "total liabilities", "total of liabilities side", "total liabilities side",
    "total (liabilities)", "grand total liabilities", "total equity & liabilities",
    "total sources of funds",
  ],
  pbit: [
    "pbit", "profit before interest and tax", "profit before interest & tax",
    "operating profit before interest", "ebit", "earnings before interest and tax",
    "net profit before interest and tax", "profit before tax + interest",
  ],
  interest: [
    "interest", "interest on loan", "interest on loans", "bank interest",
    "finance charges", "interest expenses", "interest paid",
    "interest on borrowings", "interest & finance charges", "borrowing cost",
  ],
  accounts_payable: [
    "accounts payable", "trade payables", "sundry creditors", "creditors for goods",
    "trade creditors", "creditors", "payables", "creditors for purchase",
  ],
  purchases: [
    "purchases", "net purchases", "purchase of goods", "purchase",
    "goods purchased", "cost of goods purchased", "total purchases",
  ],
  accounts_receivable: [
    "accounts receivable", "trade receivables", "sundry debtors", "debtors",
    "debtors outstanding", "receivables", "book debts", "trade debtors",
  ],
  dealer_turnover: [
    "dealer turnover", "sales", "gross sales", "net sales",
    "revenue from operations", "turnover", "total sales", "total revenue",
    "net turnover", "total turnover",
  ],
  current_assets: [
    "current assets", "total current assets", "current assets (a)", "current assets total",
  ],
  current_liabilities: [
    "current liabilities", "total current liabilities", "current liabilities (b)",
    "current liabilities total", "current liabilities & provisions",
  ],
};

// ─── Business ratio calculations ──────────────────────────────────────────

export type ComputedRatios = {
  ownerCapitalPct: number | null;
  interestCoverageRatio: number | null;
  dpo: number | null;
  dso: number | null;
  currentRatio: number | null;
  averageSales: number | null;
};

export function computeRatios(
  record: Pick<DealerRecord,
    | "owners_capital" | "total_liabilities" | "pbit" | "interest"
    | "accounts_payable" | "purchases" | "accounts_receivable"
    | "dealer_turnover" | "current_assets" | "current_liabilities">,
  prevFYRecord?: Pick<DealerRecord, "dealer_turnover">
): ComputedRatios {
  const safe = (n: number): number | null => (isFinite(n) && !isNaN(n) ? n : null);

  return {
    ownerCapitalPct: record.total_liabilities !== 0
      ? safe((record.owners_capital / record.total_liabilities) * 100) : null,
    interestCoverageRatio: record.interest !== 0
      ? safe(record.pbit / record.interest) : null,
    dpo: record.purchases !== 0
      ? safe((record.accounts_payable / record.purchases) * 365) : null,
    dso: record.dealer_turnover !== 0
      ? safe((record.accounts_receivable / record.dealer_turnover) * 365) : null,
    currentRatio: record.current_liabilities !== 0
      ? safe(record.current_assets / record.current_liabilities) : null,
    averageSales: prevFYRecord != null
      ? safe((record.dealer_turnover + prevFYRecord.dealer_turnover) / 2) : null,
  };
}