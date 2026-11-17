// Media proxy for KoboToolbox facility photographs.
//
// Requests identify an attachment by validated identifiers
// (`sid`, `aid`, `size`) or, for compatibility with cached clients, by a
// canonical legacy `url=` value that is parsed and rebuilt. The upstream URL
// is always constructed server-side; the Kobo token is only ever sent to it.
//
// D31: before any image request, the attachment must be in a fresh
// authorised attachment index (attachmentIndex.js). No fresh index gives
// 503. A miss in a fresh index gives 404 with no Kobo request.

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
export const MAX_QUERY_LENGTH = 2300;
// Browser-only cache. No shared (edge) cache: no s-maxage (D31, OD-2).
export const MEDIA_SUCCESS_CACHE_CONTROL = "private, max-age=300";

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

/** The raw query string of a request URL ("" if none). */
export function rawQueryString(originalUrl) {
  const s = typeof originalUrl === "string" ? originalUrl : "";
  const i = s.indexOf("?");
  return i === -1 ? "" : s.slice(i + 1);
}

const ID_KEYS = Object.freeze(["sid", "aid", "size"]);

/**
 * Strict query parse (D31 3.5). Keys and values come from one
 * URLSearchParams parse of the raw query string; `req.query` is not used.
 * Allowed forms: exactly `sid`, `aid`, `size`; or exactly `url` with an
 * optional `key`. Each key once. Anything else gives null (400).
 *
 * The legacy `key` value is never read, compared, logged or sent upstream.
 */
export function readAttachmentRef(rawQuery) {
  if (typeof rawQuery !== "string" || rawQuery.length === 0 || rawQuery.length > MAX_QUERY_LENGTH) return null;
  const params = new URLSearchParams(rawQuery);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null; // repeated key
  const keySet = new Set(keys);
  const isIdForm = keys.length === ID_KEYS.length && ID_KEYS.every((k) => keySet.has(k));
  const isLegacyForm =
    keySet.has("url") && keys.every((k) => k === "url" || k === "key") && keys.length <= 2;
  if (isIdForm) {
    const ref = { sid: params.get("sid"), aid: params.get("aid"), size: params.get("size") };
    return isValidAttachmentRef(ref) ? ref : null;
  }
  if (isLegacyForm) return parseLegacyAttachmentUrl(params.get("url"));
  return null;
}

export function createMediaHandler({ get, index, env = process.env, log = console }) {
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

    const ref = readAttachmentRef(rawQueryString(req.originalUrl ?? req.url));
    if (!ref) return sendError(res, 400, "Invalid image reference");

    // Refresh before membership: only a fresh index is used.
    let fresh;
    try {
      if (!index) throw Object.assign(new Error("no_index"), { code: "no_index" });
      fresh = await index.getFreshIndex();
    } catch (err) {
      log.warn(`[media] index_unavailable code=${safeToken(err?.code)}`);
      return sendError(res, 503, "Images are temporarily unavailable");
    }
    // A fresh miss: 404, no data read and no image request.
    if (!fresh.has(ref.sid, ref.aid)) return sendError(res, 404, "Image not found");

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
    if (status === 404 || status === 410) return sendError(res, 404, "Image not found");
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
      "Cache-Control": MEDIA_SUCCESS_CACHE_CONTROL,
      "Referrer-Policy": "no-referrer",
    });
    return req.method === "HEAD" ? res.end() : res.end(body);
  };
}
