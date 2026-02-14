const base = process.env.API_BASE_URL || "http://localhost:4000";
const tenant = process.env.TEST_TENANT_ID || "acme-test";

async function req(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
      ...(path === "/health" ? {} : { "x-tenant-id": tenant })
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return { status: res.status, json };
}

function ok(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const results = [];

  let r = await req("/health");
  ok(r.status === 200 && r.json?.status === "ok", "health failed");
  results.push(["GET /health", r.status]);

  r = await req("/whoami");
  ok(r.status === 200 && r.json?.tenantId === tenant, "whoami failed");
  results.push(["GET /whoami", r.status]);

  r = await req("/data-policy");
  ok(r.status === 200 && r.json?.mode === "reference-only", "data-policy failed");
  results.push(["GET /data-policy", r.status]);

  r = await req("/preview", { method: "POST", body: { sample: true } });
  ok(r.status === 200 && r.json?.preview?.sample === true, "preview failed");
  results.push(["POST /preview", r.status]);

  r = await req("/source-connections", {
    method: "POST",
    body: {
      name: "Conn A",
      inputFolderPath: "/mnt/in",
      outputFolderPath: "/mnt/out",
      protocol: "local-agent"
    }
  });
  ok(r.status === 201, "create source connection failed");
  const sourceId = r.json.id;
  results.push(["POST /source-connections", r.status]);

  r = await req("/source-connections");
  ok(r.status === 200 && Array.isArray(r.json?.items), "list source-connections failed");
  results.push(["GET /source-connections", r.status]);

  r = await req(`/source-connections/${sourceId}/deactivate`, { method: "PATCH" });
  ok(r.status === 200 && r.json?.active === false, "deactivate source connection failed");
  results.push(["PATCH /source-connections/:id/deactivate", r.status]);

  r = await req("/templates", {
    method: "POST",
    body: {
      name: "Template A",
      detectionRule: { filenamePattern: "Source1_.*" },
      mappings: [{ sourceField: "Invoice #", outputField: "invoiceNumber" }]
    }
  });
  ok(r.status === 201, "create template failed");
  const templateId = r.json.id;
  results.push(["POST /templates", r.status]);

  r = await req("/templates");
  ok(r.status === 200 && Array.isArray(r.json?.items), "list templates failed");
  results.push(["GET /templates", r.status]);

  r = await req(`/templates/${templateId}/clone`, { method: "POST" });
  ok(r.status === 201, "clone template failed");
  const clonedTemplateId = r.json.id;
  results.push(["POST /templates/:id/clone", r.status]);

  r = await req(`/templates/${clonedTemplateId}/deactivate`, { method: "PATCH" });
  ok(r.status === 200 && r.json?.active === false, "deactivate template failed");
  results.push(["PATCH /templates/:id/deactivate", r.status]);

  r = await req("/templates/export");
  ok(r.status === 200 && Array.isArray(r.json?.templates), "export templates failed");
  const bundle = r.json;
  results.push(["GET /templates/export", r.status]);

  r = await req("/templates/import", {
    method: "POST",
    body: { mode: "merge", templates: bundle.templates }
  });
  ok(r.status === 200 && typeof r.json?.imported === "number", "import templates failed");
  results.push(["POST /templates/import", r.status]);

  r = await req("/upload", {
    method: "POST",
    body: {
      fileName: "Source1_demo.pdf",
      sourcePath: "/network/docs/Source1_demo.pdf",
      outputPath: "/network/out/Source1_demo.mapped.json",
      extractedFields: [
        { label: "Invoice #", value: "INV-123" },
        { label: "Total Amount", value: "199.90" }
      ]
    }
  });
  ok(r.status === 202 && r.json?.status === "mapped", "create upload failed");
  const fileId = r.json.fileId;
  results.push(["POST /upload", r.status]);

  r = await req("/upload");
  ok(r.status === 200 && r.json?.items?.some((x) => x.fileId === fileId), "list uploads failed");
  results.push(["GET /upload", r.status]);

  r = await req(`/upload/${fileId}/status`, { method: "PATCH", body: { status: "mapped" } });
  ok(r.status === 200, "patch upload status failed");
  results.push(["PATCH /upload/:id/status", r.status]);

  r = await req(`/upload/${fileId}/process`, { method: "POST" });
  ok(r.status === 200 && r.json?.job?.status === "completed", "process upload failed");
  results.push(["POST /upload/:id/process", r.status]);

  r = await req("/mapping-jobs");
  ok(r.status === 200 && Array.isArray(r.json?.items), "list jobs failed");
  results.push(["GET /mapping-jobs", r.status]);

  r = await req("/mapping-jobs", { method: "POST", body: { fileId } });
  ok(r.status === 202, "create job failed");
  const jobId = r.json.id;
  results.push(["POST /mapping-jobs", r.status]);

  r = await req(`/mapping-jobs/${jobId}`);
  ok(r.status === 200, "get job failed");
  results.push(["GET /mapping-jobs/:id", r.status]);

  r = await req(`/mapping-jobs/${jobId}/status`, { method: "PATCH", body: { status: "processing" } });
  ok(r.status === 200 && r.json?.status === "processing", "patch job status failed");
  results.push(["PATCH /mapping-jobs/:id/status", r.status]);

  r = await req("/generate", {
    method: "POST",
    body: {
      fileId,
      mappings: [
        { sourceType: "field", sourceKey: "Invoice #", targetType: "field", targetKey: "invoiceNumber" },
        { sourceType: "field", sourceKey: "Total Amount", targetType: "field", targetKey: "total" }
      ]
    }
  });
  ok(r.status === 200 && r.json?.output?.fields?.invoiceNumber === "INV-123", "generate failed");
  results.push(["POST /generate", r.status]);

  r = await req("/dashboard/summary");
  ok(r.status === 200 && typeof r.json?.metrics?.automationRate === "number", "dashboard summary failed");
  results.push(["GET /dashboard/summary", r.status]);

  const noFile = await fetch(base + "/upload/file", {
    method: "POST",
    headers: { "x-tenant-id": tenant }
  });
  ok(noFile.status === 400, "upload/file expected 400 without file");
  results.push(["POST /upload/file (no file)", noFile.status]);

  console.log("ENDPOINT_SMOKE_TEST: PASS");
  for (const [name, status] of results) {
    console.log(`${status}\t${name}`);
  }
}

run().catch((error) => {
  console.error("ENDPOINT_SMOKE_TEST: FAIL");
  console.error(error.message || error);
  process.exit(1);
});
