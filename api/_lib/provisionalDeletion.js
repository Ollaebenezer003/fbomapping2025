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
// `isDeletionRuleReleaseBlocked` blocks all photo authorisation in every
// environment (see attachmentIndex.js). The only exception is a local run
// with `D31_LOCAL_PROVISIONAL=1` and no deployment indicator. Production
// and Preview are always blocked. Replace this module with a rule written
// from RC-12 evidence, then set the constant to false, only after owner
// approval.

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

// Local opt-in flag. Only the exact value "1" opts in.
export const LOCAL_PROVISIONAL_FLAG = "D31_LOCAL_PROVISIONAL";

// Environment variables that show a deployed or hosted runtime. If any of
// them has a value, the runtime is treated as deployed. The local flag
// never overrides this. Vercel sets VERCEL, VERCEL_ENV, VERCEL_URL,
// VERCEL_REGION and VERCEL_DEPLOYMENT_ID; NOW_REGION is the older name.
// The AWS and CI names cover other hosts and build systems.
export const DEPLOYMENT_INDICATORS = Object.freeze([
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_GIT_COMMIT_SHA",
  "NOW_REGION",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "LAMBDA_TASK_ROOT",
  "CI",
]);

function envValue(env, name) {
  if (env === null || typeof env !== "object") return "";
  const value = env[name];
  return value === undefined || value === null ? "" : String(value);
}

/** True when any deployment indicator has a value (also "0" or "false"). */
export function hasDeploymentIndicator(env) {
  return DEPLOYMENT_INDICATORS.some((name) => envValue(env, name) !== "");
}

/**
 * True only when provisional handling may run: the local flag is exactly
 * "1", NODE_ENV is absent, "development" or "test", and no deployment
 * indicator is present. Every other state is refused (fail closed).
 */
export function isLocalProvisionalAllowed(env) {
  // Only the string "1" opts in. A number, a boolean or any other text does not.
  if (env === null || typeof env !== "object" || env[LOCAL_PROVISIONAL_FLAG] !== "1") return false;
  if (hasDeploymentIndicator(env)) return false;
  const nodeEnv = envValue(env, "NODE_ENV");
  return nodeEnv === "" || nodeEnv === "development" || nodeEnv === "test";
}

/**
 * True when the provisional rule must not authorise any attachment in this
 * environment. Blocked by default in every environment, including
 * Production, Preview and any runtime with missing or unexpected values.
 * There is no Production bypass: only the local opt-in above unblocks it.
 */
export function isDeletionRuleReleaseBlocked(env, provisional = DELETION_RULE_PROVISIONAL) {
  if (!provisional) return false;
  return !isLocalProvisionalAllowed(env);
}
