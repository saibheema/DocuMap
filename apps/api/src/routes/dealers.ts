import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { getFirestore } from "../lib/firestore.js";
import { extractFinancialFields } from "../lib/pdf-extractor.js";
import { OUTPUT_FIELDS, FINANCIAL_YEAR_OPTIONS, computeRatios } from "@documap/shared";
import type { DealerRecord, OutputFieldKey } from "@documap/shared";
import admin from "firebase-admin";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const dealersRouter = Router();

// ─── Auth middleware ────────────────────────────────────────────────────────

async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email ?? "";
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized — invalid token" });
  }
}

// ─── Audit log helper ────────────────────────────────────────────────────────

async function writeAuditLog(
  uid: string,
  action: string,
  target: string,
  extra?: Record<string, unknown>
) {
  const db = getFirestore();
  if (!db) return;
  await db.collection("audit_logs").add({
    uid,
    action,
    target,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[₹$€£¥,\s()]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// ─── POST /dealers/lookup ───────────────────────────────────────────────────

dealersRouter.post("/lookup", requireAuth, async (req: any, res: any) => {
  const { dealerCode, financialYear } = req.body ?? {};
  if (!dealerCode || !financialYear) {
    return res.status(400).json({ error: "dealerCode and financialYear are required" });
  }

  const db = getFirestore();
  if (!db) return res.status(503).json({ error: "Firestore unavailable" });

  const snap = await db
    .collection("dealers").doc(String(dealerCode))
    .collection("records").doc(String(financialYear))
    .get();

  await writeAuditLog(req.uid, "lookup", `${dealerCode}/${financialYear}`);

  if (!snap.exists) {
    return res.json({ found: false, dealerCode, financialYear });
  }

  const data = snap.data() as DealerRecord;
  const ratios = computeRatios(data);
  return res.json({ found: true, record: data, ratios });
});

// ─── POST /dealers/extract ──────────────────────────────────────────────────
// Uploads a PDF, extracts the 10 financial fields, returns them — never stored.

dealersRouter.post("/extract", requireAuth, upload.single("file"), async (req: any, res: any) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file is required" });
  if (!file.originalname.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "Only PDF files are accepted" });
  }

  const { financialYear, geminiApiKey } = req.body ?? {};

  try {
    const result = await extractFinancialFields(file.buffer, financialYear ?? "", geminiApiKey);
    return res.json({
      fields: result.fields,
      unmappedFields: result.unmappedFields,
      confidence: result.confidence,
      note: result.note,
    });
  } catch (err) {
    console.error("[dealers/extract]", err);
    return res.status(500).json({
      error: "Extraction failed",
      details: err instanceof Error ? err.message : "unknown",
    });
  }
});

// ─── POST /dealers/save ─────────────────────────────────────────────────────

dealersRouter.post("/save", requireAuth, async (req: any, res: any) => {
  const {
    dealerCode, financialYear,
    owners_capital, total_liabilities, pbit, interest,
    accounts_payable, purchases, accounts_receivable, dealer_turnover,
    current_assets, current_liabilities,
    dealer_quality, seasonal_probability,
  } = req.body ?? {};

  if (!dealerCode || !financialYear) {
    return res.status(400).json({ error: "dealerCode and financialYear are required" });
  }

  // Validate all 10 numeric fields are present
  const missing = OUTPUT_FIELDS.filter((f) => req.body[f.key] == null).map((f) => f.key);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  }

  const db = getFirestore();
  if (!db) return res.status(503).json({ error: "Firestore unavailable" });

  const docRef = db
    .collection("dealers").doc(String(dealerCode))
    .collection("records").doc(String(financialYear));

  const existing = await docRef.get();

  const record: DealerRecord = {
    dealerCode:          String(dealerCode),
    financialYear:       String(financialYear),
    owners_capital:      toNumber(owners_capital),
    total_liabilities:   toNumber(total_liabilities),
    pbit:                toNumber(pbit),
    interest:            toNumber(interest),
    accounts_payable:    toNumber(accounts_payable),
    purchases:           toNumber(purchases),
    accounts_receivable: toNumber(accounts_receivable),
    dealer_turnover:     toNumber(dealer_turnover),
    current_assets:      toNumber(current_assets),
    current_liabilities: toNumber(current_liabilities),
    dealer_quality:      dealer_quality ?? "Good",
    seasonal_probability: seasonal_probability ?? "",
    createdAt:           existing.exists
                           ? (existing.data() as DealerRecord).createdAt
                           : new Date().toISOString(),
    updatedAt:           new Date().toISOString(),
    createdBy:           existing.exists
                           ? (existing.data() as DealerRecord).createdBy
                           : req.uid,
    updatedBy:           req.uid,
  };

  await docRef.set(record);
  await writeAuditLog(req.uid, existing.exists ? "update" : "create", `${dealerCode}/${financialYear}`);

  const ratios = computeRatios(record);
  return res.status(existing.exists ? 200 : 201).json({ record, ratios });
});

// ─── GET /dealers ───────────────────────────────────────────────────────────

dealersRouter.get("/", requireAuth, async (req: any, res: any) => {
  const { fy } = req.query;

  const db = getFirestore();
  if (!db) return res.status(503).json({ error: "Firestore unavailable" });

  // List all dealer docs then grab their records sub-collection
  const dealersSnap = await db.collection("dealers").listDocuments();
  const results: DealerRecord[] = [];

  for (const dealerRef of dealersSnap) {
    let query: FirebaseFirestore.Query = dealerRef.collection("records");
    if (fy) query = query.where("financialYear", "==", String(fy));
    const recordsSnap = await query.get();
    recordsSnap.forEach((doc) => results.push(doc.data() as DealerRecord));
  }

  await writeAuditLog(req.uid, "list", "dealers", { fy: fy ?? "all" });

  return res.json({ items: results, count: results.length });
});

// ─── GET /dealers/export ─────────────────────────────────────────────────────
// Must come BEFORE /:dealerCode route to avoid being captured by it

dealersRouter.get("/export", requireAuth, async (req: any, res: any) => {
  const { fy } = req.query;

  const db = getFirestore();
  if (!db) return res.status(503).json({ error: "Firestore unavailable" });

  const dealerRefs = await db.collection("dealers").listDocuments();
  const rows: object[] = [];

  for (const ref of dealerRefs) {
    let q: FirebaseFirestore.Query = ref.collection("records");
    if (fy) q = q.where("financialYear", "==", String(fy));
    const snap = await q.get();
    snap.forEach((doc) => {
      const r = doc.data() as DealerRecord;
      rows.push({
        "Dealer Code":           r.dealerCode,
        "Financial Year":        r.financialYear,
        "Owners Capital":        r.owners_capital,
        "Total Liabilities":     r.total_liabilities,
        "PBIT":                  r.pbit,
        "Interest":              r.interest,
        "Accounts Payable":      r.accounts_payable,
        "Purchases":             r.purchases,
        "Accounts Receivable":   r.accounts_receivable,
        "Dealer Turnover":       r.dealer_turnover,
        "Current Assets":        r.current_assets,
        "Current Liabilities":   r.current_liabilities,
        "Dealer Quality":        r.dealer_quality,
        "Seasonal Probability":  r.seasonal_probability,
      });
    });
  }

  await writeAuditLog(req.uid, "export", "dealers/export", { fy: fy ?? "all", rows: rows.length });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dealer Records");

  const fileName = fy ? `dealer-records-${fy}.xlsx` : "dealer-records-all.xlsx";
  const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.send(excelBuffer);
});

// ─── GET /dealers/:dealerCode/records/:financialYear ─────────────────────────

dealersRouter.get("/:dealerCode/records/:financialYear", requireAuth, async (req: any, res: any) => {
  const { dealerCode, financialYear } = req.params;

  const db = getFirestore();
  if (!db) return res.status(503).json({ error: "Firestore unavailable" });

  const snap = await db
    .collection("dealers").doc(dealerCode)
    .collection("records").doc(financialYear)
    .get();

  await writeAuditLog(req.uid, "read", `${dealerCode}/${financialYear}`);

  if (!snap.exists) return res.status(404).json({ error: "Record not found" });

  const record = snap.data() as DealerRecord;
  const ratios = computeRatios(record);
  return res.json({ record, ratios });
});
