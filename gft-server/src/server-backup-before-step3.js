import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { healthCheck } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 3000);

const allowedOrigins = String(process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin(origin, callback) {
    // Server-to-server requests and same-origin requests may have no Origin.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
  credentials: true
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

app.get("/api/health", async (_req, res) => {
  try {
    const db = await healthCheck();
    res.json({
      ok: true,
      service: "gft-server",
      database: "connected",
      time: db.now
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "gft-server",
      database: "unavailable"
    });
  }
});

app.get("/api/version", (_req, res) => {
  res.json({
    name: "Guvaza Family Trust API",
    version: "1.0.0"
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`GFT server listening on port ${port}`);
});
