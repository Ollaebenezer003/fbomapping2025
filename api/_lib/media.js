// Media proxy for KoboToolbox facility photographs.
//
// Requests identify an attachment by validated identifiers
// (`sid`, `aid`, `size`) or, for compatibility with cached clients, by a
// canonical legacy `url=` value that is parsed and rebuilt. The upstream URL
// is always constructed server-side; the Kobo token is only ever sent to it.

import { Buffer } from "node:buffer";
import process from "node:process";
import {
  KOBO_ORIGIN,
  buildAttachmentUrl,
  isValidAttachmentRef,
  parseLegacyAttachmentUrl,
} from "./kobo.js";

export const MEDIA_MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB response limit
export const MEDIA_TIMEOUT_MS = 8000;

const EXTENSIONS = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
const TYPE_ALIASES = Object.freeze({ "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg" });
const DISABLED_VALUES = new Set(["false", "0", "off", "no"]);

const ERROR_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

export function isMediaProxyDisabled(env) {
  return DISABLED_VALUES.has(String(env?.MEDIA_PROXY_ENABLED ?? "").trim().toLowerCase());
}

export function normaliseContentType(value) {
  if (typeof value !== "string") return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return TYPE_ALIASES[type] ?? type;
}

export function detectImageType(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// Values written to logs are restricted to short, known-safe tokens.
function safeToken(value) {
  const s = String(value ?? "");
  return /^[A-Za-z0-9_./-]{1,40}$/.test(s) ? s : "unknown";
}

function redirectHost(location) {
  if (typeof location !== "string") return "none";
  try {
    const host = new URL(location, KOBO_ORIGIN).host;
    return /^[A-Za-z0-9.:[\]-]{1,255}$/.test(host) ? host : "invalid";
  } catch {
    return "invalid";
  }
}

function sendError(res, status, message) {
  res.status(status).set(ERROR_HEADERS).json({ error: message });
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Resolve the request to a validated attachment reference, or null. */
export function readAttachmentRef(query) {
  const q = query ?? {};
  const idKeys = ["sid", "aid", "size"];
  const usesIds = idKeys.some((k) => hasOwn(q, k));
  const usesUrl = hasOwn(q, "url");
  if (usesIds && usesUrl) return null; // ambiguous
  if (usesIds) {
    const ref = {};
    for (const key of idKeys) {
      if (typeof q[key] !== "string") return null; // missing or repeated
      ref[key] = q[key];
    }
    return isValidAttachmentRef(ref) ? ref : null;
  }
  if (usesUrl) {
    return typeof q.url === "string" ? parseLegacyAttachmentUrl(q.url) : null;
  }
  return null;
}

export function createMediaHandler({ get, env = process.env, log = console }) {
  return async function mediaHandler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      return sendError(res, 405, "Method not allowed");
    }

    if (isMediaProxyDisabled(env)) {
      return sendError(res, 503, "Images are temporarily unavailable");
    }

    const token = env.KOBO_TOKEN;
    if (!token) {
      log.error("[media] config_error code=missing_token");
      return sendError(res, 503, "Images are temporarily unavailable");
    }

    const ref = readAttachmentRef(req.query);
    if (!ref) return sendError(res, 400, "Invalid image reference");

    let upstream;
    try {
      upstream = await get(buildAttachmentUrl(ref), {
        headers: {
          Authorization: `Token ${token}`,
          Accept: "image/jpeg, image/png, image/webp",
          "Accept-Encoding": "identity",
        },
        timeoutMs: MEDIA_TIMEOUT_MS,
        maxBytes: MEDIA_MAX_BYTES,
      });
    } catch (err) {
      const code = safeToken(err?.code);
      log.warn(`[media] upstream_error code=${code}`);
      return sendError(res, code === "TIMEOUT" ? 504 : 502, "Failed to load image");
    }

    const status = upstream?.status;
    if (status >= 300 && status < 400) {
      log.warn(`[media] upstream_redirect_rejected status=${status} host=${redirectHost(upstream.headers?.location)}`);
      return sendError(res, 502, "Failed to load image");
    }
    if (status === 404) return sendError(res, 404, "Image not found");
    if (status === 401 || status === 403) {
      log.error(`[media] kobo_auth_failure status=${status}`);
      return sendError(res, 502, "Failed to load image");
    }
    if (status !== 200) {
      log.warn(`[media] upstream_status status=${safeToken(status)}`);
      return sendError(res, 502, "Failed to load image");
    }

    const body = upstream.body;
    const declared = normaliseContentType(upstream.headers?.["content-type"]);
    const detected = detectImageType(body);
    if (
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.length > MEDIA_MAX_BYTES ||
      !declared ||
      !hasOwn(EXTENSIONS, declared) ||
      detected !== declared
    ) {
      log.warn(`[media] content_rejected declared=${safeToken(declared)} detected=${safeToken(detected)}`);
      return sendError(res, 502, "Failed to load image");
    }

    res.status(200).set({
      "Content-Type": declared,
      "Content-Length": String(body.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `inline; filename="photo.${EXTENSIONS[declared]}"`,
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Referrer-Policy": "no-referrer",
    });
    return req.method === "HEAD" ? res.end() : res.end(body);
  };
}
