import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { uploadRouter } from "./routes/upload.js";
import { templateRouter } from "./routes/templates.js";
import { jobsRouter } from "./routes/jobs.js";
import { sourceConnectionsRouter } from "./routes/source-connections.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { generateRouter } from "./routes/generate.js";
import { mappingsRouter } from "./routes/mappings.js";
import { tenantMiddleware } from "./middleware/tenant.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "documap-api" });
});

app.use(tenantMiddleware);

app.get("/whoami", (req, res) => {
  res.json({ tenantId: req.tenantId });
});

app.use("/upload", uploadRouter);
app.use("/source-connections", sourceConnectionsRouter);
app.use("/templates", templateRouter);
app.use("/mapping-jobs", jobsRouter);
app.use("/dashboard", dashboardRouter);
app.use("/generate", generateRouter);
app.use("/mappings", mappingsRouter);

app.get("/data-policy", (req, res) => {
  res.json({
    tenantId: req.tenantId,
    mode: "reference-only",
    statement:
      "Document content remains in client network folders. App stores only mapping metadata, file references, and processing status."
  });
});

app.post("/preview", (req, res) => {
  res.json({
    tenantId: req.tenantId,
    preview: req.body,
    validation: {
      missingRequired: []
    }
  });
});

const server = app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down API server...`);
  server.close((err) => {
    if (err) {
      console.error("Error during server shutdown", err);
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.warn("Force exiting API process after shutdown timeout");
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
