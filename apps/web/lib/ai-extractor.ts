/**
 * AI-powered PDF field extraction using Google Gemini API.
 *
 * Sends the raw PDF bytes to Gemini's multimodal endpoint and asks it to
 * extract every key-value field it can find.  Falls back gracefully when
 * the API key is missing or the call fails.
 */

const GEMINI_LOCALSTORAGE_KEY = "documap:gemini-api-key";

/* ------------------------------------------------------------------ */
/*  API-key helpers (persisted in localStorage)                       */
/* ------------------------------------------------------------------ */

export function getGeminiApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GEMINI_LOCALSTORAGE_KEY) ?? "";
}

export function setGeminiApiKey(key: string) {
  if (typeof window === "undefined") return;
  if (key.trim()) {
    localStorage.setItem(GEMINI_LOCALSTORAGE_KEY, key.trim());
  } else {
    localStorage.removeItem(GEMINI_LOCALSTORAGE_KEY);
  }
}

/* ------------------------------------------------------------------ */
/*  Core extraction via Gemini                                        */
/* ------------------------------------------------------------------ */

export type AiExtractedField = {
  id: string;
  label: string;
  value: string;
  confidence: number;
};

const EXTRACTION_PROMPT = `You are an expert OCR and document data extraction system. Analyze this PDF document (which may be scanned, image-based, or text-based) and extract ALL key-value data fields you can find.

Instructions:
1. First, perform OCR if needed to read all text from the document, even if it's a scanned image or has poor quality.
2. Extract every piece of structured data: dates, amounts, names, addresses, IDs, reference numbers, totals, descriptions, account numbers, percentages, phone numbers, email addresses, signatures, handwritten notes, stamps, etc.
3. For tables, extract each row as separate fields with descriptive labels (e.g. "Row 1 - Item Description", "Row 1 - Amount").
4. Use the exact field label as it appears in the document. If a field has no label, create a clear descriptive one.
5. Use the exact value as it appears in the document, preserving formatting like currency symbols, decimals, and dates.
6. Do NOT skip any data. Extract everything, even if it seems insignificant or is partially visible.
7. For multi-line values, join them with a space.
8. If text is unclear or partially visible, include it with a note like "[unclear]" or "[partial]" in the value.

Return ONLY a valid JSON array. No markdown, no explanation, no code fences. Just the raw JSON array:
[{"label": "Field Name", "value": "Field Value"}, ...]`;

/**
 * Send a PDF to Gemini and get structured fields back.
 * Returns null when the key is missing or the call fails.
 */
export async function extractFieldsWithGemini(
  file: File,
  onProgress?: (msg: string) => void
): Promise<AiExtractedField[] | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  onProgress?.("Uploading PDF to Gemini AI...");

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const fileSizeMB = bytes.length / (1024 * 1024);

  // For large PDFs (> 4MB), use Gemini File Upload API for reliability
  // For smaller PDFs, use inline_data (simpler, faster)
  let fileUri: string | null = null;

  if (fileSizeMB > 4) {
    onProgress?.(`Uploading ${fileSizeMB.toFixed(1)} MB PDF via File API...`);
    try {
      fileUri = await uploadToGeminiFileApi(bytes, file.name, apiKey, onProgress);
    } catch (err) {
      console.warn("[DocuMap] File API upload failed, falling back to inline_data:", err);
    }
  }

  // Chunked base64 conversion (used as fallback or for small files)
  let base64 = "";
  if (!fileUri) {
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    base64 = btoa(binary);
  }

  // Use latest GA stable models (Gemini 2.5 Flash is best for price-performance)
  const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"];

  for (const model of models) {
    try {
      onProgress?.(`Analyzing ${Math.round(fileSizeMB)} MB document with ${model}...`);

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      // Build parts: either file_data (uploaded) or inline_data (base64)
      const pdfPart = fileUri
        ? { file_data: { mime_type: "application/pdf", file_uri: fileUri } }
        : { inline_data: { mime_type: "application/pdf", data: base64 } };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                pdfPart,
                {
                  text: EXTRACTION_PROMPT
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 65536
          }
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error(`[DocuMap] Gemini ${model} API error ${response.status}:`, errBody);
        onProgress?.(`API error: ${response.status} - trying fallback...`);
        // Try next model for common errors
        if ([400, 403, 404, 429].includes(response.status)) continue;
        // For other errors, stop trying
        return null;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        error?: { message?: string };
      };

      if (data.error) {
        console.warn(`Gemini ${model} error:`, data.error.message);
        continue;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text.trim()) {
        console.warn(`[DocuMap] Gemini ${model} returned empty text`);
        continue;
      }

      console.log(`[DocuMap] Gemini ${model} raw response (first 500 chars):`, text.slice(0, 500));
      onProgress?.("Parsing AI extraction results...");

      const fields = parseGeminiResponse(text);
      console.log(`[DocuMap] Parsed ${fields.length} fields from Gemini response`);
      if (fields.length > 0) {
        return fields;
      }

      console.warn(`[DocuMap] Gemini ${model} returned text but no fields parsed. Raw text:`, text.slice(0, 1000));
      continue;
    } catch (err) {
      console.warn(`Gemini ${model} call failed:`, err);
      continue;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                  */
/* ------------------------------------------------------------------ */

function parseGeminiResponse(rawText: string): AiExtractedField[] {
  // Strip markdown code fences if present
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  cleaned = cleaned.trim();

  // Try to find a JSON array in the response
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");

  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
    return [];
  }

  const jsonStr = cleaned.slice(arrayStart, arrayEnd + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try fixing common JSON issues (trailing commas, etc.)
    try {
      const fixed = jsonStr.replace(/,\s*([}\]])/g, "$1");
      parsed = JSON.parse(fixed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const fields: AiExtractedField[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).label !== "string"
    ) {
      continue;
    }

    const label = ((item as Record<string, string>).label ?? "").trim();
    // Gemini may return numbers or booleans as values — coerce to string
    const rawValue = (item as Record<string, unknown>).value;
    const value = (rawValue == null ? "" : String(rawValue)).trim();

    if (!label || !value) continue;

    const key = `${label.toLowerCase()}::${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    fields.push({
      id: `ef_${fields.length + 1}`,
      label,
      value,
      confidence: 0.95
    });
  }

  return fields;
}

/* ------------------------------------------------------------------ */
/*  Gemini File Upload API — for large PDFs (> 4MB)                   */
/* ------------------------------------------------------------------ */

async function uploadToGeminiFileApi(
  bytes: Uint8Array,
  fileName: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  // Step 1: Start resumable upload
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": "application/pdf",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file: { display_name: fileName }
      })
    }
  );

  if (!startRes.ok) {
    throw new Error(`File API start failed: ${startRes.status}`);
  }

  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned");

  // Step 2: Upload the bytes
  onProgress?.("Uploading file to Gemini...");
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Type": "application/pdf"
    },
    body: new Blob([bytes as BlobPart], { type: "application/pdf" })
  });

  if (!uploadRes.ok) {
    throw new Error(`File upload failed: ${uploadRes.status}`);
  }

  const uploadData = (await uploadRes.json()) as {
    file?: { uri?: string; name?: string; state?: string };
  };

  const fileUri = uploadData.file?.uri;
  const fileName2 = uploadData.file?.name;
  if (!fileUri) throw new Error("No file URI returned after upload");

  // Step 3: Wait for file to be processed (ACTIVE state)
  let state = uploadData.file?.state ?? "PROCESSING";
  let attempts = 0;

  while (state === "PROCESSING" && attempts < 30) {
    onProgress?.("Waiting for file processing...");
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;

    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName2}?key=${apiKey}`
    );
    if (checkRes.ok) {
      const checkData = (await checkRes.json()) as {
        state?: string;
        uri?: string;
      };
      state = checkData.state ?? "ACTIVE";
    }
  }

  if (state !== "ACTIVE") {
    throw new Error(`File not ready after processing: state=${state}`);
  }

  console.log("[DocuMap] File uploaded to Gemini:", fileUri);
  return fileUri;
}
