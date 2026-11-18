// KoboToolbox URL contract. Every URL that carries the Kobo token is built
// here from constants and strictly validated identifiers.
//
// Attachment routes (kobotoolbox/kpi, kpi/views/v2/attachment.py):
//   /api/v2/assets/{asset_uid}/data/{submission_id}/attachments/{attachment_uid_or_id}/{suffix}/
// Pagination (kpi/paginators.py): `next` is the request URL with `limit` and
// `start` replaced.

export const KOBO_HOST = "kf.kobotoolbox.org";
export const KOBO_ORIGIN = `https://${KOBO_HOST}`;
export const KOBO_ASSET_UID = "axiToevLp9NRbpQvzMBKV3";
export const KOBO_DATA_PATH = `/api/v2/assets/${KOBO_ASSET_UID}/data/`;

// Records requested per page. Kobo's default page size is 100 and its
// default maximum is 1000 (kobo/settings/base.py DEFAULT_API_PAGE_SIZE /
// MAX_API_PAGE_SIZE); a larger value is clamped to the server maximum
// (kpi/paginators.py, `_positive_int(..., cutoff=max_limit)`).
export const KOBO_PAGE_SIZE = 1000;
export const KOBO_DATA_URL = `${KOBO_ORIGIN}${KOBO_DATA_PATH}?format=json&limit=${KOBO_PAGE_SIZE}`;

// Numeric IDs must be canonical (no leading zero), so that one attachment or
// record has exactly one accepted spelling (D31 F-3).
export const SUBMISSION_ID_RE = /^(?:0|[1-9]\d{0,11})$/;
export const ATTACHMENT_ID_RE = /^(?:att[A-Za-z0-9]{8,64}|0|[1-9]\d{0,11})$/;
export const ATTACHMENT_SIZES = Object.freeze(["small", "medium", "large"]);
export const MAX_REFERENCE_URL_LENGTH = 2048;

// Safety bound on pagination, not a capacity guarantee. The practical record
// ceiling is set first by independent limits: the function's 40 s maxDuration
// (vercel.json), the 10 s per-page timeout, and Vercel's 4.5 MB function
// response limit on the /facilities payload.
export const MAX_KOBO_PAGES = 100;

const LEGACY_ATTACHMENT_PATH_RE = new RegExp(
  `^/api/v2/assets/${KOBO_ASSET_UID}/data/(0|[1-9]\\d{0,11})/attachments/(att[A-Za-z0-9]{8,64}|0|[1-9]\\d{0,11})/(small|medium|large)/$`,
);
const PAGINATION_PARAMS = new Set(["format", "limit", "start"]);
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/;

export function isValidAttachmentRef(ref) {
  return (
    ref !== null &&
    typeof ref === "object" &&
    typeof ref.sid === "string" &&
    typeof ref.aid === "string" &&
    typeof ref.size === "string" &&
    SUBMISSION_ID_RE.test(ref.sid) &&
    ATTACHMENT_ID_RE.test(ref.aid) &&
    ATTACHMENT_SIZES.includes(ref.size)
  );
}

export function buildAttachmentUrl(ref) {
  if (!isValidAttachmentRef(ref)) throw new Error("invalid_attachment_reference");
  return `${KOBO_ORIGIN}/api/v2/assets/${KOBO_ASSET_UID}/data/${ref.sid}/attachments/${ref.aid}/${ref.size}/`;
}

// Parse an absolute Kobo URL with no credentials, port, fragment or
// non-printable characters. Returns a URL object or null.
function parseStrictKoboUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REFERENCE_URL_LENGTH) return null;
  if (!PRINTABLE_ASCII_RE.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== KOBO_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return url;
}

/**
 * Accept a legacy `url=` value only when it is exactly a canonical Kobo
 * attachment URL for this asset. The caller's string is never fetched: the
 * identifiers are extracted and the URL is rebuilt with buildAttachmentUrl.
 */
export function parseLegacyAttachmentUrl(raw) {
  const url = parseStrictKoboUrl(raw);
  if (!url) return null;
  // Reject anything the URL parser had to normalise (case, dot segments,
  // default port, encoding), so only the exact canonical form is accepted.
  if (url.href !== raw) return null;
  if (url.search !== "" && url.search !== "?format=json") return null;
  const match = LEGACY_ATTACHMENT_PATH_RE.exec(url.pathname);
  if (!match) return null;
  const ref = { sid: match[1], aid: match[2], size: match[3] };
  return isValidAttachmentRef(ref) ? ref : null;
}

/**
 * Pagination guard: exact origin, exact asset data endpoint, and only the
 * query parameters Kobo itself emits (format=json, numeric limit/start).
 * Values are checked after percent-decoding; any other key (e.g. offset,
 * page, page_size, fields, query, sort) is rejected.
 */
export function isAllowedKoboDataUrl(raw) {
  const url = parseStrictKoboUrl(raw);
  if (!url || url.pathname !== KOBO_DATA_PATH) return false;
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!PAGINATION_PARAMS.has(key) || seen.has(key)) return false;
    seen.add(key);
    if (key === "format" ? value !== "json" : !/^\d{1,9}$/.test(value)) return false;
  }
  return seen.has("format");
}

export class KoboFetchError extends Error {
  constructor(code) {
    super(`kobo_fetch_failed_${code}`);
    this.name = "KoboFetchError";
    this.code = code;
  }
}

/**
 * Follow Kobo pagination until `next` is null. Output is identical to the
 * previous implementation (concatenated `results`, or `data` for the
 * single-page shape), but every page URL is validated before the token is
 * attached, loops and excessive page counts are rejected, and redirects
 * (any non-2xx status) fail closed.
 */
export async function fetchAllKoboData({
  get,
  token,
  startUrl = KOBO_DATA_URL,
  maxPages = MAX_KOBO_PAGES,
  timeoutMs = 10000,
  maxPageBytes = 32 * 1024 * 1024,
}) {
  if (!token) throw new KoboFetchError("missing_token");
  let url = startUrl;
  const visited = new Set();
  let allRecords = [];

  while (url) {
    if (typeof url !== "string" || !isAllowedKoboDataUrl(url)) throw new KoboFetchError("untrusted_page_url");
    const key = new URL(url).href;
    if (visited.has(key)) throw new KoboFetchError("pagination_loop");
    if (visited.size >= maxPages) throw new KoboFetchError("page_limit");
    visited.add(key);

    let res;
    try {
      res = await get(url, {
        headers: { Authorization: `Token ${token}`, Accept: "application/json" },
        timeoutMs,
        maxBytes: maxPageBytes,
      });
    } catch (err) {
      throw new KoboFetchError(typeof err?.code === "string" ? err.code : "network");
    }
    if (res.status < 200 || res.status >= 300) throw new KoboFetchError(`status_${res.status}`);

    let data;
    try {
      data = JSON.parse(res.body.toString("utf8"));
    } catch {
      throw new KoboFetchError("invalid_json");
    }

    if (data?.results) {
      allRecords = allRecords.concat(data.results);
      url = data.next; // go to next page
    } else if (data?.data) {
      allRecords = allRecords.concat(data.data);
      url = null;
    } else {
      url = null;
    }
  }

  return allRecords;
}
