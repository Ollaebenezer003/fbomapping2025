import express from "express";
import cors from "cors";
import process from "node:process";
import { mapRecordChoices } from "./choiceMapper.js";
import { fetchAllKoboData } from "./kobo.js";
import { createMediaHandler } from "./media.js";
import {
  PHOTO_QUESTION_XPATHS,
  createAttachmentIndex,
  createAttachmentPolicy,
  projectAuthorisedAttachments,
} from "./attachmentIndex.js";
import { guardedGet } from "./safeHttp.js";

const ALLOWED_ORIGINS = ["https://fbomapping2025.vercel.app", "http://localhost:5173"];

function safeCode(value) {
  const s = String(value ?? "");
  return /^[A-Za-z0-9_]{1,60}$/.test(s) ? s : "unknown";
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Image-question answers hold raw Kobo file names. No front-end function
// uses them (images are addressed by `_attachments` IDs), so /facilities
// does not send them (D31 L-4).
const IMAGE_ANSWER_KEYS = Object.freeze([...PHOTO_QUESTION_XPATHS]);

function withoutImageAnswers(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  if (!IMAGE_ANSWER_KEYS.some((key) => hasOwn(record, key))) return record;
  const out = { ...record };
  for (const key of IMAGE_ANSWER_KEYS) delete out[key];
  return out;
}

/**
 * API key check for /facilities (D31 L-5). A missing or empty `API_KEY`
 * never disables the check: the route fails closed with 503 in every
 * environment. Local testing sets `API_KEY` explicitly. The key value is
 * never logged or returned.
 */
export function checkApiKey(provided, configured) {
  if (typeof configured !== "string" || configured.length === 0) return "not_configured";
  if (typeof provided !== "string" || provided !== configured) return "invalid";
  return "ok";
}

/**
 * Build the API application. Dependencies are injectable so the security
 * tests can run without network access; production uses the defaults.
 * `indexOptions` (clock, timer, limits) and `policyOptions` are for tests only.
 */
export function createApp({
  get = guardedGet,
  env = process.env,
  log = console,
  now = Date.now,
  indexOptions = {},
  policyOptions = {},
} = {}) {
  const app = express();

  // D31: one policy and one per-instance attachment index.
  const policy = createAttachmentPolicy({ env, ...policyOptions });
  const index = createAttachmentIndex({
    get,
    getToken: () => env.KOBO_TOKEN,
    policy,
    now,
    log,
    ...indexOptions,
  });

  app.use(
    cors({
      origin: "https://fbomapping2025.vercel.app",
      methods: ["GET"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json());

  // GET FACILITIES. Response shape unchanged except `_attachments`, which
  // holds only authorised attachments with only `uid`, `id` and `mimetype`.
  app.get("/facilities", async (req, res) => {
    try {
      const origin = req.headers.origin;

      // Detect unauthorized origins
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return res.status(403).json({ message: "Unauthorized Access!" });
      }

      // Detect wrong API Keys in Frontend Calls. A missing API_KEY fails closed.
      const keyState = checkApiKey(req.query.key, env.API_KEY);
      if (keyState === "not_configured") {
        log.error("[facilities] config_error code=missing_api_key");
        return res.status(503).set("Cache-Control", "no-store").json({ error: "Service temporarily unavailable" });
      }
      if (keyState !== "ok") {
        return res.status(403).json({ message: "Unauthorized" });
      }

      log.log("KOBO TOKEN:", env.KOBO_TOKEN ? "Loaded" : "Missing");

      const readStartedAt = now();
      const raw = await fetchAllKoboData({ get, token: env.KOBO_TOKEN });

      // Reuse this fresh read for the index (same age rule and order rule).
      index.offer(raw, readStartedAt);

      const cleaned = raw.map((rec) => {
        let mapped;
        try {
          mapped = mapRecordChoices(rec);
        } catch {
          log.error("[facilities] record_mapping_error");
          mapped = rec;
        }
        mapped = withoutImageAnswers(mapped);
        if (mapped === null || typeof mapped !== "object" || !hasOwn(mapped, "_attachments")) return mapped;
        return { ...mapped, _attachments: projectAuthorisedAttachments(rec, policy) };
      });

      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=300");

      return res.json(cleaned ?? []);
    } catch (err) {
      log.error(`[facilities] kobo_fetch_failed code=${safeCode(err?.code)}`);
      return res.status(500).json({ error: "Failed to fetch data from Kobo" });
    }
  });

  // MEDIA PROXY
  const mediaHandler = createMediaHandler({ get, index, env, log });
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
