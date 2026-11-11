import express from "express";
import cors from "cors";
import process from "node:process";
import { mapRecordChoices } from "./choiceMapper.js";
import { fetchAllKoboData } from "./kobo.js";
import { createMediaHandler } from "./media.js";
import { guardedGet } from "./safeHttp.js";

const ALLOWED_ORIGINS = ["https://fbomapping2025.vercel.app", "http://localhost:5173"];

function safeCode(value) {
  const s = String(value ?? "");
  return /^[A-Za-z0-9_]{1,60}$/.test(s) ? s : "unknown";
}

/**
 * Build the API application. Dependencies are injectable so the security
 * tests can run without network access; production uses the defaults.
 */
export function createApp({ get = guardedGet, env = process.env, log = console } = {}) {
  const app = express();

  app.use(
    cors({
      origin: "https://fbomapping2025.vercel.app",
      methods: ["GET"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json());

  // GET FACILITIES (response shape unchanged)
  app.get("/facilities", async (req, res) => {
    try {
      const origin = req.headers.origin;

      // Detect unauthorized origins
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return res.status(403).json({ message: "Unauthorized Access!" });
      }

      // Detect wrong API Keys in Frontend Calls
      if (req.query.key !== env.API_KEY) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      log.log("KOBO TOKEN:", env.KOBO_TOKEN ? "Loaded" : "Missing");

      const raw = await fetchAllKoboData({ get, token: env.KOBO_TOKEN });

      const cleaned = raw.map((rec) => {
        try {
          return mapRecordChoices(rec);
        } catch {
          log.error("[facilities] record_mapping_error");
          return rec;
        }
      });

      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=300");

      return res.json(cleaned ?? []);
    } catch (err) {
      log.error(`[facilities] kobo_fetch_failed code=${safeCode(err?.code)}`);
      return res.status(500).json({ error: "Failed to fetch data from Kobo" });
    }
  });

  // MEDIA PROXY
  const mediaHandler = createMediaHandler({ get, env, log });
  app.all("/media", async (req, res) => {
    const origin = req.headers.origin;
    // Requests without an Origin header (e.g. <img>) are allowed.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      log.warn("[media] blocked_origin");
      return res.status(403).json({ message: "Unauthorized Access!" });
    }
    try {
      return await mediaHandler(req, res);
    } catch {
      log.error("[media] handler_error");
      if (!res.headersSent) {
        res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        return res.status(500).json({ error: "Failed to load image" });
      }
      return res.end();
    }
  });

  return app;
}
