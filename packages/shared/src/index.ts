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
  { key: "owners_capital", label: "Owners Capital", required: true, type: "number" },
  { key: "total_liabilities", label: "Total Liabilities", required: true, type: "number" },
  { key: "pbit", label: "PBIT", required: true, type: "number" },
  { key: "interest", label: "Interest", required: true, type: "number" },
  { key: "accounts_payable", label: "Accounts Payable", required: true, type: "number" },
  { key: "accounts_receivable", label: "Accounts Receivable", required: true, type: "number" },
  { key: "dealer_turnover", label: "Dealer Turnover", required: true, type: "number" },
  { key: "purchases", label: "Purchases", required: true, type: "number" },
  { key: "current_assets", label: "Current Assets", required: true, type: "number" },
  { key: "current_liabilities", label: "Current Liabilities", required: true, type: "number" }
];