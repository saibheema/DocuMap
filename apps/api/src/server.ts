import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { dealersRouter } from "./routes/dealers.js";
import { getFirestore } from "./lib/firestore.js";

dotenv.config();

// Initialize Firebase Admin SDK at startup (before any requests)
getFirestore();

const app = express();
const port = Number(process.env.PORT || 4000);

const allowedOrigins = [
  "https://documap-cs-hc-8f0222acc86c43eca440f9a4.web.app",
  "https://documap-cs-hc-8f0222acc86c43eca440f9a4.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:3001",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Handle all OPTIONS preflight requests before any other middleware
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));
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
