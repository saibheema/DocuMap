# Dealer Financial Data Capture — Change Plan

## Application Purpose
Allow Marketing Officers to upload a dealer audited financial PDF, extract 10 key financial values, store them in Firestore per dealer per financial year, calculate business ratios, and export a master Excel report.

---

## UI — Screens to KEEP (stripped to essentials only)

### 1. Login
- Path: `/`
- Purpose: Firebase Authentication. No access to any screen without login.
- Only Marketing Officers with valid credentials can proceed.

### 2. Dealer Lookup
- Path: `/lookup`
- Purpose: Entry point after login. Officer enters Dealer Code + selects Financial Year.
- System checks Firestore for existing record.
  - Record found → go to `/review` with existing data pre-filled
  - Record not found → go to `/upload` with Dealer Code + FY pre-set

### 3. Upload & Extract
- Path: `/upload`
- Purpose: Upload financial PDF, extract 10 fields using AI/OCR.
- PDF is processed in memory only — never stored anywhere.
- Officer reviews extracted values, corrects any errors, then saves to Firestore.

### 4. Review & Compare
- Path: `/review`
- Purpose: Show existing Firestore record for that Dealer Code + FY.
- If a new PDF is uploaded here, show side-by-side diff of old vs new values.
- Officer chooses: Replace or Retain each field individually.

### 5. Records List
- Path: `/records`
- Purpose: List all dealer records the officer has access to.
- Filter by FY. Export all as master Excel file.

### 6. Manual Field Mapping (Fallback)
- Path: `/mapping`
- Purpose: Used only when AI could not confidently map an extracted value to one of the 10 output fields.
- Shows only the unmatched extracted values (not all fields).
- Officer assigns each unmatched value to the correct output field via a simple dropdown.
- Normal flow skips this screen entirely if all 10 fields are auto-mapped.
- Acts as future-proofing: if a dealer uses a new term not in the synonym map, the officer maps it here and that mapping can be fed back into the synonym map.

## UI — Screens to REMOVE
- `/connections` — Source Connections (not needed)
- `/mapping-visual` — Visual Mapping (not needed, `/mapping` covers the fallback case)
- `/templates` — Templates (not needed)
- `/jobs` — Jobs monitor (not needed)
- `/dashboard` — Generic SaaS dashboard (replace with Dealer Lookup as home)
- `/ingestion` — Generic ingestion page (replaced by `/upload`)

---

## Data Model (Firestore)

```
dealers/{dealerCode}/records/{financialYear}
  dealerCode: string
  financialYear: string              // e.g. "2024-25"
  owners_capital: number
  total_liabilities: number
  pbit: number
  interest: number
  accounts_payable: number
  purchases: number
  accounts_receivable: number
  dealer_turnover: number
  current_assets: number
  current_liabilities: number
  dealer_quality: "Good" | "Medium" | "Excellent" | "Poor"
  seasonal_probability: string       // entered by officer
  createdAt: timestamp
  updatedAt: timestamp
  createdBy: string                  // Firebase Auth UID
  updatedBy: string
```

---

## Business Calculations (computed on the fly, not stored)

| Calculation | Formula |
|---|---|
| Owner Capital % of Total Liabilities | `owners_capital / total_liabilities * 100` |
| Interest Coverage Ratio | `pbit / interest` |
| Days Payable Outstanding (DPO) | `accounts_payable / purchases * 365` |
| Days Sales Outstanding (DSO) | `accounts_receivable / dealer_turnover * 365` |
| Current Ratio | `current_assets / current_liabilities` |
| Average Sales (Last 24 Months) | `(current FY turnover + previous FY turnover) / 2` |

> Note: Existing Sales to Credit Limit Ratio, Existing LOC to Ideal LOC Ratio,
> and Adjusted Expected Sales to Credit Limit require Credit Limit as an additional
> manual input. To be confirmed with business team before implementing.

---

## Output Format (Excel Export)

Single flat row per dealer per FY:

| Dealer Code | Financial Year | Owners Capital | Total Liabilities | PBIT | Interest | Accounts Payable | Purchases | Accounts Receivable | Dealer Turnover | Current Assets | Current Liabilities | Dealer Quality | Seasonal Probability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Generated on demand from Firestore. Not stored as a file anywhere.

---

## Security Requirements

- [ ] Firebase Authentication — mandatory before any screen is accessible
- [ ] Firestore Security Rules — users can only read/write their own records
- [ ] PDF never stored — extract in memory, discard immediately after extraction
- [ ] HTTPS only — already enforced by Firebase Hosting + Cloud Run
- [ ] Audit log — write to `audit_logs` collection on every record read/write
- [ ] Data residency — GCP region `asia-south1` (Mumbai) for all services

---

## Backend Changes Required

### API routes to REMOVE
- `/source-connections` and all related routes
- `/mapping-jobs` and all related routes
- `/templates` and all related routes
- `/mappings` (generic mapping store)
- `/mapping-memory`
- `/generate` (generic generate endpoint)
- `/dashboard`

### API routes to ADD
- `POST /dealers/lookup` — check if Dealer Code + FY exists in Firestore
- `POST /dealers/extract` — upload PDF, extract 10 fields, return values (no storage)
- `POST /dealers/save` — save/update extracted values to Firestore
- `GET /dealers` — list all records for the logged-in officer
- `GET /dealers/{dealerCode}/records/{FY}` — get a specific record
- `GET /dealers/export` — generate and return master Excel from Firestore

### Shared package changes
- Add `FINANCIAL_YEAR_OPTIONS` list (e.g. 2022-23 through 2025-26)
- Add `DEALER_QUALITY_OPTIONS` constant
- Add `computeRatios(record)` function for all business calculations
- Add synonym map for all 10 fields (used by AI extraction prompt)

### PDF Extractor changes
- Replace generic label:value parser with finance-domain extraction
- Add section detection: Balance Sheet / P&L / Trading Account / Trial Balance
- Add comparative column detection: extract only the selected FY column
- Embed synonym map for all 10 fields into Gemini AI prompt

---

## Synonym Map (for extraction and auto-mapping)

| Output Field | Accepted Source Names |
|---|---|
| Owners Capital | Capital Account, Partner Capital, Proprietor Capital, Reserves & Surplus |
| Total Liabilities | Total liabilities side of balance sheet, Owners Capital + Secured Loans + Unsecured Loans + Current Liabilities + Provisions |
| PBIT | Net Profit + Interest + Tax, Operating Profit before Interest |
| Interest | Interest on Loan, Bank Interest, Finance Charges |
| Accounts Payable | Sundry Creditors, Trade Payables, Creditors for Goods |
| Purchases | Purchases, Net Purchases, Purchase of Goods |
| Accounts Receivable | Sundry Debtors, Trade Receivables, Debtors Outstanding |
| Dealer Turnover | Sales, Gross Sales, Net Sales, Revenue from Operations |
| Current Assets | Cash, Bank Balance, Sundry Debtors, Inventory/Stock, Short-term Loans & Advances, Other Current Assets |
| Current Liabilities | Sundry Creditors, Trade Payables, Short-term Borrowings, Outstanding Expenses, Statutory Dues |

---

## TO-DO LIST

### Phase 1 — Security & Auth
- [ ] Add Firebase Authentication to the web app
- [ ] Add auth guards to all routes (redirect to `/` if not logged in)
- [ ] Write Firestore Security Rules (authenticated users only, scoped by role)
- [ ] Add `audit_logs` collection write on every Firestore read/write

### Phase 2 — Remove Unused Code
- [ ] Delete web pages: `/connections`, `/mapping-visual`, `/templates`, `/jobs`, `/ingestion`, `/dashboard` (keep `/mapping` — repurposed as fallback)
- [ ] Delete API routes: source-connections, templates, jobs, mappings, mapping-memory, generate, dashboard
- [ ] Delete lib files: `mapping-memory-store.ts`, `mapping-file-store.ts`, `template-repository.ts`
- [ ] Remove tenant-based multi-tenancy middleware (single org use case)
- [ ] Clean up `shared/src/index.ts` — keep only `OUTPUT_FIELDS`
- [ ] Remove unused npm packages from web and api

### Phase 3 — Data Model & API
- [ ] Create Firestore collection structure `dealers/{dealerCode}/records/{FY}`
- [ ] Build `POST /dealers/lookup` endpoint
- [ ] Build `POST /dealers/extract` endpoint (PDF to 10 fields, no storage)
- [ ] Build `POST /dealers/save` endpoint (write to Firestore)
- [ ] Build `GET /dealers` list endpoint
- [ ] Build `GET /dealers/{dealerCode}/records/{FY}` get specific record endpoint
- [ ] Build `GET /dealers/export` Excel export endpoint
- [ ] Add `computeRatios()` to shared package
- [ ] Add `FINANCIAL_YEAR_OPTIONS` and `DEALER_QUALITY_OPTIONS` to shared package
- [ ] Add synonym map to shared package

### Phase 4 — PDF Extraction Improvements
- [ ] Add financial section detection (Balance Sheet / P&L / Trading / Trial Balance)
- [ ] Add comparative year column detection (pick only selected FY column)
- [ ] Embed full synonym map into Gemini AI prompt
- [ ] Test extraction accuracy against real dealer financial PDFs

### Phase 5 — UI Rebuild (minimal screens only)
- [ ] Build `/` Login screen (Firebase Auth sign-in)
- [ ] Build `/lookup` Dealer Code + FY entry screen with Firestore check
- [ ] Build `/upload` PDF upload + 10-field review/correction screen (auto-maps known fields; links to `/mapping` for unmatched ones)
- [ ] Build `/review` existing record view + side-by-side compare diff (Replace / Retain per field)
- [ ] Build `/records` dealer record list + master Excel export screen
- [ ] Rework `/mapping` — strip out generic drag-and-drop, replace with simple dropdown assignment of unmatched fields only (target options = 10 fixed output fields)
- [ ] Replace SaaSShell with minimal app shell (logo, logged-in user, sign-out only)

### Phase 6 — Testing & Deployment
- [ ] Test with real dealer financial PDFs (Trial Balance, P&L, Balance Sheet formats)
- [ ] Validate all 10 field extractions across different dealer formats
- [ ] Validate all ratio calculations
- [ ] Verify Excel export matches required column format
- [ ] Deploy updated API to Cloud Run
- [ ] Deploy updated web to Firebase Hosting
- [ ] Deploy updated API to Cloud Run
- [ ] Deploy updated web to Firebase Hosting