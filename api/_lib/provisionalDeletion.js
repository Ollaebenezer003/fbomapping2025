// PROVISIONAL DELETION CHECK (D31 condition A-5).
//
// STATUS: PROVISIONAL. FOR LOCAL TESTING ONLY. NOT APPROVED FOR PRODUCTION.
//
// RC-12 (the Kobo deletion and restoration experiment) is not complete.
// This check does not state what any deletion-marker field means. It only
// accepts the two attachment states that the read-only count (RC-9) saw
// in production data, and it refuses every other state:
//
//   - `is_deleted` is absent           -> not refused (seen in RC-9)
//   - `is_deleted` is exactly `false`  -> not refused (seen in RC-9)
//   - `is_deleted` has any other value -> refused (positive or ambiguous)
//   - any other key whose name refers to deletion, trash or removal is
//     present, with any value         -> refused (not seen, ambiguous)
//   - the attachment is not a plain object -> refused
//
// "Not refused" is not evidence that the attachment is not deleted.
//
// Release control: `DELETION_RULE_PROVISIONAL` is true. While it is true,
// `isDeletionRuleReleaseBlocked` blocks all photo authorisation in a
// Vercel Production environment (see attachmentIndex.js). Replace this
// module with a rule written from RC-12 evidence, then set the flag to
// false, only after owner approval.

export const DELETION_RULE_PROVISIONAL = true;
export const DELETION_RULE_STATUS = "PROVISIONAL_PENDING_RC12";

// Key names that refer to deletion, trash or removal. Matched without case.
const DELETION_KEY_RE = /delet|trash|remov|purg|discard/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Provisional A-5 check. Returns true if the attachment must be refused.
 * Fails closed: an unknown or ambiguous state returns true.
 */
export function isProvisionallyDeleted(attachment) {
  if (!isPlainObject(attachment)) return true;
  for (const key of Object.keys(attachment)) {
    if (key === "is_deleted") {
      if (attachment.is_deleted !== false) return true;
      continue;
    }
    if (DELETION_KEY_RE.test(key)) return true;
  }
  return false;
}

/**
 * True when the provisional rule must not authorise any attachment in this
 * environment. Only a Vercel Production environment is blocked, so local
 * tests and local development keep working.
 */
export function isDeletionRuleReleaseBlocked(env, provisional = DELETION_RULE_PROVISIONAL) {
  if (!provisional) return false;
  return String(env?.VERCEL_ENV ?? "").trim().toLowerCase() === "production";
}
