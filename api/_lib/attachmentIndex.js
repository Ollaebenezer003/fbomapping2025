// D31 authorised attachment index.
//
// One authorisation predicate (`isAuthorisedAttachment`) decides which Kobo
// attachments the GIS can show. Both the `/media` index and the
// `/facilities` attachment projection use it. There is no second copy.
//
// The index is per function instance and in memory only. It holds
// `Map<submission id, Set<attachment id>>` and nothing else: no record
// content, no file name and no URL. It reads Kobo with GET only and never
// deletes anything. Kobo is the only system that manages or deletes images.
//
// Freshness: an index is used only while `now - readStartedAt <= maxAgeMs`.
// The age starts when the Kobo read starts. There is no grace period and
// no stale use. When no fresh index is available, callers get an
// `IndexUnavailableError` and must answer 503.

import { fetchAllKoboData } from "./kobo.js";
import {
  DELETION_POLICY_APPROVED,
  hasDeletionIndicator,
  hasRecordDeletionIndicator,
  isDeletionRuleReleaseBlocked,
} from "./deletionPolicy.js";

// Owner-approved values (D31, local implementation approval 2026-11-17).
export const INDEX_MAX_AGE_MS = 300_000;
// Provisional pending runtime verification (OD-12, option T-2).
export const INDEX_BUILD_TIMEOUT_MS = 25_000;
export const INDEX_RETRY_BACKOFF_MS = 30_000;
// Same page size and per-page limit as /facilities. 2 pages expected.
export const INDEX_MAX_PAGES = 5;
export const INDEX_PAGE_TIMEOUT_MS = 10_000;

// OD-4, approved by the owner 2026-11-17.
export const PHOTO_QUESTION_XPATHS = Object.freeze([
  "facility_pictures/facility_picture",
  "organisation_pictures/organisation_picture",
]);

const RECORD_ID_RE = /^\d{1,12}$/;
const ATTACHMENT_UID_RE = /^att[A-Za-z0-9]{8,64}$/;
const NUMERIC_ID_RE = /^\d{1,12}$/;

export class IndexUnavailableError extends Error {
  constructor(code) {
    super(`attachment_index_unavailable_${code}`);
    this.name = "IndexUnavailableError";
    this.code = code;
  }
}

function codeError(code) {
  return Object.assign(new Error(code), { code });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null;
}

/** The record's submission ID as a string, or null if it is not valid. */
export function recordSubmissionId(record) {
  if (!isPlainObject(record)) return null;
  const raw = record._id;
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 && RECORD_ID_RE.test(String(raw)) ? String(raw) : null;
  }
  return typeof raw === "string" && RECORD_ID_RE.test(raw) ? raw : null;
}

/**
 * The identifiers of an attachment (A-6), or null. A present identifier
 * with an invalid value makes the attachment invalid (fail closed).
 */
export function attachmentIdentifiers(attachment) {
  if (!isPlainObject(attachment)) return null;
  const ids = [];
  if (hasValue(attachment, "uid")) {
    if (typeof attachment.uid !== "string" || !ATTACHMENT_UID_RE.test(attachment.uid)) return null;
    ids.push(attachment.uid);
  }
  if (hasValue(attachment, "id")) {
    const id = attachment.id;
    const text = typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? String(id) : id;
    if (typeof text !== "string" || !NUMERIC_ID_RE.test(text)) return null;
    ids.push(text);
  }
  return ids.length > 0 ? ids : null;
}

/** A-1: the record is in the public facility dataset (every valid record). */
export function isPublicRecord(record) {
  return recordSubmissionId(record) !== null;
}

/**
 * Policy for the predicate. While the deletion policy is not approved the
 * policy is blocked in every environment, so no attachment is authorised.
 * Only a local run with `D31_LOCAL_PROVISIONAL=1` and no deployment
 * indicator is unblocked (deletionPolicy.js).
 */
export function createAttachmentPolicy({
  env = {},
  photoQuestionXpaths = PHOTO_QUESTION_XPATHS,
  isDeleted = hasDeletionIndicator,
  deletionPolicyApproved = DELETION_POLICY_APPROVED,
} = {}) {
  return Object.freeze({
    photoQuestionXpaths: new Set(photoQuestionXpaths),
    isDeleted,
    releaseBlocked: isDeletionRuleReleaseBlocked(env, deletionPolicyApproved),
  });
}

/**
 * The single D31 authorisation predicate (A-1 to A-6). All conditions must
 * be true. Any error is a refusal.
 */
export function isAuthorisedAttachment(record, attachment, policy) {
  try {
    if (!policy || policy.releaseBlocked) return false;
    if (!isPublicRecord(record)) return false; // A-1 and record ID
    if (hasRecordDeletionIndicator(record)) return false; // A-5 (record)
    if (!Array.isArray(record._attachments) || !record._attachments.includes(attachment)) return false; // A-2
    if (!isPlainObject(attachment)) return false;
    const type = attachment.mimetype;
    if (typeof type !== "string" || !type.trim().toLowerCase().startsWith("image/")) return false; // A-3
    const xpath = attachment.question_xpath;
    if (typeof xpath !== "string" || !policy.photoQuestionXpaths.has(xpath)) return false; // A-4
    if (policy.isDeleted(attachment) !== false) return false; // A-5 (attachment)
    return attachmentIdentifiers(attachment) !== null; // A-6
  } catch {
    return false;
  }
}

// Every identifier-like value of an attachment, valid or not. Used only to
// find identifiers that are ambiguous inside one record.
function claimedIdentifiers(attachment) {
  if (!isPlainObject(attachment)) return [];
  const out = [];
  if (typeof attachment.uid === "string") out.push(attachment.uid);
  if (typeof attachment.id === "number" || typeof attachment.id === "string") out.push(String(attachment.id));
  return out;
}

/**
 * The authorised attachments of one record. Used by both the index and the
 * `/facilities` projection, so both list the same IDs. An authorised
 * attachment is dropped when one of its identifiers is on more than one
 * attachment of the record, also when the other entry is refused (for
 * example a deleted one). Kobo serves `(sid, aid)` without telling which
 * entry it used, so such an identifier is ambiguous.
 */
export function authorisedAttachmentsOf(record, policy) {
  try {
    if (!isPlainObject(record) || !Array.isArray(record._attachments)) return [];
    const uses = new Map();
    for (const attachment of record._attachments) {
      for (const id of claimedIdentifiers(attachment)) uses.set(id, (uses.get(id) ?? 0) + 1);
    }
    return record._attachments.filter(
      (a) => isAuthorisedAttachment(record, a, policy) && attachmentIdentifiers(a).every((id) => uses.get(id) === 1),
    );
  } catch {
    return [];
  }
}

/**
 * `/facilities` projection: only authorised attachments, with only `uid`,
 * `id` and `mimetype`. No URL, file name or other key reaches the browser.
 */
export function projectAuthorisedAttachments(record, policy) {
  return authorisedAttachmentsOf(record, policy)
    .map((a) => {
      const out = {};
      if (hasValue(a, "uid")) out.uid = a.uid;
      if (hasValue(a, "id")) out.id = a.id;
      out.mimetype = a.mimetype;
      return out;
    });
}

function makeIndex(entries, readStartedAt) {
  let count = 0;
  for (const set of entries.values()) count += set.size;
  return Object.freeze({
    readStartedAt,
    attachmentCount: count,
    has(sid, aid) {
      const set = entries.get(String(sid));
      return set !== undefined && set.has(String(aid));
    },
    ids() {
      return [...entries].flatMap(([sid, set]) => [...set].map((aid) => `${sid}/${aid}`)).sort();
    },
  });
}

const EMPTY_INDEX = makeIndex(new Map(), Number.POSITIVE_INFINITY);

/**
 * Build index content from Kobo records. Throws a coded error for empty or
 * malformed data. The caller decides about "zero authorised attachments".
 */
export function buildIndexFromRecords(records, readStartedAt, policy) {
  if (!Array.isArray(records)) throw codeError("malformed_data");
  if (records.length === 0) throw codeError("empty_data");
  const entries = new Map();
  for (const record of records) {
    if (!isPlainObject(record)) throw codeError("malformed_record");
    if (!Array.isArray(record._attachments)) continue;
    const sid = recordSubmissionId(record);
    for (const attachment of authorisedAttachmentsOf(record, policy)) {
      let set = entries.get(sid);
      if (!set) entries.set(sid, (set = new Set()));
      for (const id of attachmentIdentifiers(attachment)) set.add(id);
    }
  }
  return makeIndex(entries, readStartedAt);
}

function defaultSetTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

const SAFE_CODE_RE = /^[A-Za-z0-9_]{1,60}$/;
const safeCode = (value) => (SAFE_CODE_RE.test(String(value ?? "")) ? String(value) : "unknown");

/**
 * Create one per-instance index.
 *
 * - `get` is the guarded GET function. The index wraps it with a deadline
 *   guard, so no page request starts after the deadline, and each page gets
 *   `timeoutMs <= time left`.
 * - `getToken` returns the Kobo token at build time.
 * - `now` and `setTimer` are injectable for tests.
 * - `fetchRecords(deadlineGet, token)` is injectable for tests.
 */
export function createAttachmentIndex({
  get,
  getToken = () => undefined,
  policy,
  now = Date.now,
  setTimer = defaultSetTimer,
  maxAgeMs = INDEX_MAX_AGE_MS,
  buildTimeoutMs = INDEX_BUILD_TIMEOUT_MS,
  backoffMs = INDEX_RETRY_BACKOFF_MS,
  pageTimeoutMs = INDEX_PAGE_TIMEOUT_MS,
  maxPages = INDEX_MAX_PAGES,
  fetchRecords = (deadlineGet, token) =>
    fetchAllKoboData({ get: deadlineGet, token, maxPages, timeoutMs: pageTimeoutMs }),
  log = console,
} = {}) {
  if (!policy) throw new Error("attachment_policy_required");

  let current = null; // last installed index
  let inflight = null; // current single-flight build
  let lastFailureAt = null;
  let generation = 0;
  let installedGeneration = 0;

  const isFresh = (idx, t) => idx !== null && t - idx.readStartedAt <= maxAgeMs && t >= idx.readStartedAt;

  function install(idx, gen) {
    if (current && idx.readStartedAt <= current.readStartedAt) return false; // older or equal result
    current = idx;
    installedGeneration = gen;
    return true;
  }

  // Reject a result with zero authorised attachments when the last index
  // had some. Kobo answers in an unknown shape become [] (D31-IN4).
  function checkNotEmptied(idx) {
    if (idx.attachmentCount === 0 && current && current.attachmentCount > 0) {
      throw codeError("no_authorised_attachments");
    }
  }

  function startBuild() {
    const gen = ++generation;
    const readStartedAt = now();
    const deadlineAt = readStartedAt + buildTimeoutMs;
    const build = { gen, readStartedAt, abandoned: false, settled: false };
    let resolveWaiters;
    let rejectWaiters;
    build.promise = new Promise((resolve, reject) => {
      resolveWaiters = resolve;
      rejectWaiters = reject;
    });
    build.promise.catch(() => {});

    const fail = (code) => {
      if (build.settled) return;
      build.settled = true;
      if (inflight === build) inflight = null;
      // A newer fresh index was installed while this build was pending
      // (for example by a /facilities offer). Waiters get that index and no
      // backoff starts. The failed result itself is never installed.
      if (isFresh(current, now())) {
        log.warn(`[index] build_failed_fresh_index_used code=${safeCode(code)}`);
        resolveWaiters(current);
        return;
      }
      lastFailureAt = now();
      log.warn(`[index] build_failed code=${safeCode(code)}`);
      rejectWaiters(new IndexUnavailableError(safeCode(code)));
    };

    const cancelDeadline = setTimer(() => {
      if (build.settled) return;
      build.abandoned = true; // a later result is dropped
      fail("build_deadline");
    }, buildTimeoutMs);

    const deadlineGet = (url, opts = {}) => {
      if (build.abandoned || build.settled) return Promise.reject(codeError("build_abandoned"));
      const remaining = deadlineAt - now();
      if (remaining <= 0) return Promise.reject(codeError("build_deadline"));
      const requested = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : pageTimeoutMs;
      return get(url, { ...opts, timeoutMs: Math.max(1, Math.min(requested, remaining)) });
    };

    inflight = build;
    Promise.resolve()
      .then(() => fetchRecords(deadlineGet, getToken()))
      .then(
        (records) => {
          cancelDeadline();
          if (build.abandoned || build.settled) {
            log.warn("[index] late_result_dropped");
            return;
          }
          let idx;
          try {
            idx = buildIndexFromRecords(records, readStartedAt, policy);
            checkNotEmptied(idx);
          } catch (err) {
            fail(err?.code ?? "invalid_data");
            return;
          }
          install(idx, gen);
          // The result must satisfy the freshness rule now. If it does not
          // (for example the clock moved back), it is a failed build and the
          // backoff starts. There is no grace period.
          if (!isFresh(current, now())) {
            fail("stale_result");
            return;
          }
          build.settled = true;
          if (inflight === build) inflight = null;
          lastFailureAt = null;
          resolveWaiters(current);
        },
        (err) => {
          cancelDeadline();
          if (build.abandoned || build.settled) return;
          fail(err?.code ?? "build_error");
        },
      );
    return build.promise;
  }

  /**
   * Return a fresh index. Refresh first if the index is missing or expired.
   * Membership must be checked only against the index that this returns.
   */
  async function getFreshIndex() {
    if (policy.releaseBlocked) throw new IndexUnavailableError("release_blocked");
    if (policy.photoQuestionXpaths.size === 0) return EMPTY_INDEX; // no photo is served
    const t = now();
    if (isFresh(current, t)) return current;
    let idx;
    if (inflight) {
      idx = await inflight.promise;
    } else {
      if (lastFailureAt !== null && t - lastFailureAt < backoffMs) {
        throw new IndexUnavailableError("backoff");
      }
      idx = await startBuild();
    }
    if (!isFresh(idx, now())) throw new IndexUnavailableError("stale");
    return idx;
  }

  /**
   * Offer records that `/facilities` read from Kobo. Accepted only if fresh,
   * valid, and newer than the installed index. Never throws.
   */
  function offer(records, readStartedAt) {
    try {
      if (policy.releaseBlocked || policy.photoQuestionXpaths.size === 0) return false;
      if (!Number.isFinite(readStartedAt) || !isFresh({ readStartedAt }, now())) return false;
      const idx = buildIndexFromRecords(records, readStartedAt, policy);
      checkNotEmptied(idx);
      return install(idx, ++generation);
    } catch {
      return false;
    }
  }

  function inspect() {
    return {
      hasIndex: current !== null,
      readStartedAt: current?.readStartedAt ?? null,
      attachmentCount: current?.attachmentCount ?? 0,
      building: inflight !== null,
      lastFailureAt,
      generation,
      installedGeneration,
    };
  }

  return { getFreshIndex, offer, inspect, policy };
}
