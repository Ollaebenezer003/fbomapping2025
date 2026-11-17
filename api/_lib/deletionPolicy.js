// D31 condition A-5: deletion policy RC9-METADATA-1 (OPS-070).
//
// RC-12 was discontinued by owner decision. Kobo deletion semantics are
// NOT VERIFIED. This policy uses only the attachment metadata that the
// read-only count (RC-9) saw in production data:
//
//   - `is_deleted` absent                -> no deletion indicator
//   - `is_deleted` is exactly `false`    -> no deletion indicator
//
// Every other state is refused:
//
//   - `is_deleted` with any other value  -> refused (explicit or ambiguous)
//   - any other attachment key whose name refers to deletion, trash or
//     removal, with any value            -> refused (not evidenced)
//   - a record system key (leading `_`) whose name refers to deletion,
//     trash or removal, with any value   -> all photos of that record refused
//   - an attachment or record that is not a plain object -> refused
//
// "No deletion indicator" is NOT evidence that an attachment is active.
// Authorisation also needs presence in a fresh Kobo read (300 s from the
// read start) and the identifier checks in attachmentIndex.js. The policy
// cannot detect a Kobo deletion that leaves the attachment in
// `_attachments` with no indicator. That condition is unresolved.
//
// Release control: `DELETION_POLICY_APPROVED` is a code constant. While it
// is false, every deployed or unknown environment is blocked (no photo is
// authorised and /media gives 503). Only a local run with
// `D31_LOCAL_PROVISIONAL=1` and no deployment indicator may use the policy
// before approval. There is no environment flag that unblocks Production.
// Set the constant to true only in a reviewed commit after the owner
// approves this policy and accepts its residual risk.

export const DELETION_POLICY_ID = "RC9_METADATA_1";
export const DELETION_POLICY_APPROVED = false;

// Key names that refer to deletion, trash or removal. Matched without case.
const DELETION_KEY_RE = /delet|trash|remov|purg|discard/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Attachment-level A-5 check. Returns true if the attachment must be
 * refused. Fails closed: an unknown or ambiguous state returns true.
 */
export function hasDeletionIndicator(attachment) {
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
 * Record-level A-5 check. Only system keys (leading `_`) are checked, so a
 * form question name cannot block photos. Returns true if every photo of
 * the record must be refused.
 */
export function hasRecordDeletionIndicator(record) {
  if (!isPlainObject(record)) return true;
  return Object.keys(record).some((key) => key.startsWith("_") && DELETION_KEY_RE.test(key));
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
 * True only when the unapproved policy may run: the local flag is exactly
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
 * True when no attachment may be authorised in this environment. While the
 * policy is not approved, every environment is blocked except the local
 * opt-in above. Only the exact value `true` counts as approval.
 */
export function isDeletionRuleReleaseBlocked(env, approved = DELETION_POLICY_APPROVED) {
  if (approved === true) return false;
  return !isLocalProvisionalAllowed(env);
}
