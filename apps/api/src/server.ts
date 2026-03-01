import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { dealersRouter } from "./routes/dealers.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "documap-api" });
});

app.use("/dealers", dealersRouter);

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
