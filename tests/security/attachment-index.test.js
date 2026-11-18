// D31 attachment index: unit tests with a manual clock and a stub `get`.
// No network access. Synthetic records only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  INDEX_BUILD_TIMEOUT_MS,
  INDEX_MAX_AGE_MS,
  INDEX_PAGE_TIMEOUT_MS,
  INDEX_RETRY_BACKOFF_MS,
  PHOTO_QUESTION_XPATHS,
  attachmentIdentifiers,
  authorisedAttachmentsOf,
  buildIndexFromRecords,
  createAttachmentIndex,
  createAttachmentPolicy,
  isAuthorisedAttachment,
  projectAuthorisedAttachments,
} from "../../api/_lib/attachmentIndex.js";
import {
  DELETION_POLICY_APPROVED,
  DELETION_POLICY_ID,
  DEPLOYMENT_INDICATORS,
  hasDeletionIndicator,
  hasRecordDeletionIndicator,
  isDeletionRuleReleaseBlocked,
  isLocalProvisionalAllowed,
} from "../../api/_lib/deletionPolicy.js";
import { KOBO_DATA_URL, KOBO_DATA_PATH, KOBO_ORIGIN } from "../../api/_lib/kobo.js";
import { createGuardedGet } from "../../api/_lib/safeHttp.js";
import {
  FACILITY_XPATH, LOCAL_ENV, ORGANISATION_XPATH, TOKEN, captureLog, fakeClock, flush, isDataPageUrl, jsonPage,
  koboStub, photo, recordingTransport,
} from "./helpers.js";

const UID_A = "attAAAAAAAAAAAAAAAAAAAAA";
const UID_B = "attBBBBBBBBBBBBBBBBBBBBB";
const UID_C = "attCCCCCCCCCCCCCCCCCCCCC";
const POLICY = createAttachmentPolicy({ env: LOCAL_ENV });
const PAGE2 = `${KOBO_ORIGIN}${KOBO_DATA_PATH}?format=json&limit=1000&start=1000`;

const recordA = () => ({ _id: 101, _attachments: [photo(UID_A, { id: 1 })] });
const recordB = () => ({ _id: 102, _attachments: [photo(UID_B, { id: 2, question_xpath: ORGANISATION_XPATH })] });

function setup({ records = [recordA(), recordB()], dataResponder, ...opts } = {}) {
  const clock = fakeClock();
  const stub = koboStub({ records, dataResponder });
  const { log, lines } = captureLog();
  const index = createAttachmentIndex({
    get: stub.get,
    getToken: () => TOKEN,
    policy: POLICY,
    now: clock.now,
    setTimer: clock.setTimer,
    log,
    ...opts,
  });
  return { clock, stub, index, lines };
}

/** A data responder whose answers the test releases by hand. */
function gatedData() {
  const pending = [];
  const responder = (url, opts) =>
    new Promise((resolve, reject) => pending.push({ url, opts, resolve, reject }));
  return { responder, pending };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err.name === "IndexUnavailableError" && err.code === code);
}

// ---- Approved constants -------------------------------------------------

test("D31 approved constants", () => {
  assert.equal(INDEX_MAX_AGE_MS, 300_000);
  assert.equal(INDEX_BUILD_TIMEOUT_MS, 25_000);
  assert.equal(INDEX_RETRY_BACKOFF_MS, 30_000);
  assert.equal(INDEX_PAGE_TIMEOUT_MS, 10_000);
  assert.deepEqual([...PHOTO_QUESTION_XPATHS], [FACILITY_XPATH, ORGANISATION_XPATH]);
  assert.ok(Object.isFrozen(PHOTO_QUESTION_XPATHS));
});

// ---- Predicate (A-1 to A-6) ---------------------------------------------

test("D31-T3 (predicate): approved and rejected attachments", () => {
  const ok = (att, rec) => {
    const record = rec ?? { _id: 7, _attachments: [att] };
    if (!record._attachments.includes(att)) record._attachments = [att];
    return isAuthorisedAttachment(record, att, POLICY);
  };
  // Approved question paths, both identifier forms.
  assert.equal(ok(photo(UID_A)), true);
  assert.equal(ok(photo(UID_A, { question_xpath: ORGANISATION_XPATH })), true);
  assert.equal(ok({ id: 9, mimetype: "image/png", question_xpath: FACILITY_XPATH }), true);
  assert.equal(ok({ id: "9", mimetype: "IMAGE/JPEG", question_xpath: FACILITY_XPATH }), true);
  assert.equal(ok(photo(UID_A), { _id: "7", _attachments: [] }), true);

  // Rejected question paths (exact match only).
  for (const xpath of ["facility_picture", "facility_pictures/facility_picture ", "other/photo", "FACILITY_PICTURES/FACILITY_PICTURE", "", null, 1]) {
    assert.equal(ok(photo(UID_A, { question_xpath: xpath })), false, String(xpath));
  }
  const noXpath = photo(UID_A);
  delete noXpath.question_xpath;
  assert.equal(ok(noXpath), false);

  // Missing or invalid metadata.
  const noType = photo(UID_A);
  delete noType.mimetype;
  assert.equal(ok(noType), false, "missing mimetype");
  for (const type of ["audio/mp3", "video/mp4", "application/pdf", "text/html", "", null, 5, "imagex/jpeg"]) {
    assert.equal(ok(photo(UID_A, { mimetype: type })), false, String(type));
  }
  for (const uid of ["att", "attSHORT", "../x", "att<script>xx", 12, "", "ATTAAAAAAAAAAAA"]) {
    assert.equal(ok(photo(uid)), false, `uid ${uid}`);
  }
  assert.equal(ok(photo(UID_A, { id: "1/2" })), false, "valid uid with invalid id fails closed");
  assert.equal(ok(photo(UID_A, { id: -1 })), false);
  assert.equal(ok(photo(UID_A, { id: 1.5 })), false);
  assert.equal(ok({ mimetype: "image/jpeg", question_xpath: FACILITY_XPATH }), false, "no identifier");

  // Record checks (A-1, A-2).
  for (const id of [undefined, null, "abc", "1;2", -1, 1.5, "1234567890123", 1e13]) {
    assert.equal(ok(photo(UID_A), { _id: id, _attachments: [] }), false, `record id ${id}`);
  }
  const att = photo(UID_A);
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [] }, att, POLICY), false, "not in record");
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [{ ...att }] }, att, POLICY), false, "copy is not membership");
  assert.equal(isAuthorisedAttachment(null, att, POLICY), false);
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [att] }, att, null), false, "no policy");
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [null] }, null, POLICY), false);

  // Delete marker (A-5).
  assert.equal(ok(photo(UID_A, { is_deleted: false })), true);
  assert.equal(ok(photo(UID_A, { is_deleted: true })), false);

  // A throwing isDeleted is a refusal.
  const throwing = createAttachmentPolicy({ env: LOCAL_ENV, isDeleted: () => { throw new Error("x"); } });
  assert.equal(throwing.releaseBlocked, false, "the refusal comes from isDeleted, not the release block");
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [att] }, att, throwing), false);
  const truthy = createAttachmentPolicy({ env: LOCAL_ENV, isDeleted: () => "no" });
  const falsy = createAttachmentPolicy({ env: LOCAL_ENV, isDeleted: () => false });
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [att] }, att, falsy), true, "control: false authorises");
  assert.equal(isAuthorisedAttachment({ _id: 7, _attachments: [att] }, att, truthy), false, "only false authorises");
});

test("attachment identifiers: uid and numeric id are both indexed", () => {
  assert.deepEqual(attachmentIdentifiers(photo(UID_A, { id: 42 })), [UID_A, "42"]);
  assert.deepEqual(attachmentIdentifiers({ id: "7" }), ["7"]);
  assert.deepEqual(attachmentIdentifiers({ uid: UID_A, id: null }), [UID_A]);
  assert.equal(attachmentIdentifiers({}), null);
});

// ---- Deletion policy RC9_METADATA_1 (isolated, fail closed) ---------------

const DELETION_KEYS = ["deleted_at", "date_deleted", "delete_status", "deleted", "isDeleted", "in_trash", "trashed_at", "removed", "purged", "discarded", "IS_DELETED"];

test("OPS-070 deletion policy: only RC-9 observed states pass; explicit and ambiguous states fail closed", () => {
  assert.equal(DELETION_POLICY_ID, "RC9_METADATA_1");
  // Observed in RC-9: field absent, or exactly false.
  assert.equal(hasDeletionIndicator({ uid: UID_A }), false);
  assert.equal(hasDeletionIndicator({ uid: UID_A, is_deleted: false }), false);
  // Positive or ambiguous values.
  for (const value of [true, "true", "false", "False", 0, 1, null, "", "yes", {}, []]) {
    assert.equal(hasDeletionIndicator({ is_deleted: value }), true, `is_deleted=${JSON.stringify(value)}`);
  }
  // is_deleted=false never overrides another deletion-like key.
  assert.equal(hasDeletionIndicator({ is_deleted: false, deleted_at: null }), true);
  // Other deletion-like keys were not evidenced: any presence fails closed.
  for (const key of DELETION_KEYS) {
    for (const value of [null, false, "", "x", true]) {
      assert.equal(hasDeletionIndicator({ [key]: value }), true, `${key}=${JSON.stringify(value)}`);
    }
  }
  // Not an attachment object.
  for (const value of [null, undefined, "x", 1, []]) assert.equal(hasDeletionIndicator(value), true);
});

test("OPS-070 deletion policy: record system keys that refer to deletion refuse every photo of the record", () => {
  assert.equal(hasRecordDeletionIndicator({ _id: 1, _status: "submitted_via_web", _attachments: [] }), false);
  // Form question names (no leading underscore) do not block photos.
  assert.equal(hasRecordDeletionIndicator({ _id: 1, "group/reason_removed": "x", deleted_items: "y" }), false);
  for (const key of ["_deleted", "_is_deleted", "_deleted_at", "_trashed", "_removed", "__deleted"]) {
    for (const value of [null, false, "", true]) {
      const rec = { ...recordA(), [key]: value };
      assert.equal(hasRecordDeletionIndicator(rec), true, `${key}=${JSON.stringify(value)}`);
      assert.equal(isAuthorisedAttachment(rec, rec._attachments[0], POLICY), false, key);
      assert.deepEqual(projectAuthorisedAttachments(rec, POLICY), [], key);
      assert.equal(buildIndexFromRecords([rec], 0, POLICY).attachmentCount, 0, key);
    }
  }
  for (const value of [null, [], "x"]) assert.equal(hasRecordDeletionIndicator(value), true);
});

test("OPS-070 deletion policy: ambiguous identifiers in one record are refused in the index and the projection", () => {
  const cases = [
    ["same uid on a deleted entry", [photo(UID_A, { id: 1 }), photo(UID_A, { id: 2, is_deleted: true })], [UID_A, "1", "2"]],
    ["same numeric id on a deleted entry", [photo(UID_A, { id: 1 }), photo(UID_B, { id: 1, deleted_at: "x" })], [UID_A, UID_B, "1"]],
    ["same uid twice, both active", [photo(UID_A, { id: 1 }), photo(UID_A, { id: 2 })], [UID_A, "1", "2"]],
    ["number and string forms of one id", [photo(UID_A, { id: 1 }), photo(UID_B, { id: "1" })], [UID_A, UID_B, "1"]],
    ["same uid on a non-photo entry", [photo(UID_A, { id: 1 }), photo(UID_A, { id: 5, question_xpath: "other/q" })], [UID_A, "1", "5"]],
  ];
  for (const [label, attachments, refusedIds] of cases) {
    const rec = { _id: 9, _attachments: attachments };
    const idx = buildIndexFromRecords([rec], 0, POLICY);
    for (const aid of refusedIds) assert.equal(idx.has("9", aid), false, `${label}: ${aid}`);
    assert.equal(idx.attachmentCount, 0, label);
    assert.deepEqual(projectAuthorisedAttachments(rec, POLICY), [], label);
  }
  // Control: an unrelated active attachment in the same record stays authorised.
  const rec = { _id: 9, _attachments: [photo(UID_A, { id: 1 }), photo(UID_A, { id: 2, is_deleted: true }), photo(UID_C, { id: 3 })] };
  assert.deepEqual(buildIndexFromRecords([rec], 0, POLICY).ids(), ["9/3", `9/${UID_C}`]);
  assert.deepEqual(authorisedAttachmentsOf(rec, POLICY), [rec._attachments[2]]);
  assert.deepEqual(projectAuthorisedAttachments(rec, POLICY), [{ uid: UID_C, id: 3, mimetype: "image/jpeg" }]);
});

test("OD-21: the deletion policy is approved by the code constant; no environment variable changes the gate", () => {
  assert.equal(DELETION_POLICY_APPROVED, true, "OD-21 approval is recorded in code");
  // Approved: Production, Preview and unknown environments use the policy.
  for (const env of [{}, null, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL: "1" }]) {
    const policy = createAttachmentPolicy({ env });
    assert.equal(policy.releaseBlocked, false, JSON.stringify(env));
    assert.ok(Object.isFrozen(policy), "the policy cannot be changed after creation");
  }
  assert.equal(createAttachmentPolicy().releaseBlocked, false);
  // Environment variables cannot withdraw or replace the approval, or the check.
  for (const env of [
    { VERCEL_ENV: "production", DELETION_POLICY_APPROVED: "false" },
    { VERCEL_ENV: "production", D31_DELETION_POLICY_APPROVED: "0" },
    { VERCEL_ENV: "production", D31_LOCAL_PROVISIONAL: "0" },
    { VERCEL_ENV: "production", isDeleted: "false", releaseBlocked: "true" },
  ]) {
    const policy = createAttachmentPolicy({ env });
    assert.equal(policy.releaseBlocked, false, JSON.stringify(env));
    assert.equal(policy.isDeleted, hasDeletionIndicator, JSON.stringify(env));
  }

  // The block mechanism still works if the code constant is set to false.
  for (const env of [{}, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL: "1" }]) {
    assert.equal(createAttachmentPolicy({ env, deletionPolicyApproved: false }).releaseBlocked, true, JSON.stringify(env));
  }
  // With the constant false, no environment variable approves it.
  for (const env of [
    { VERCEL_ENV: "production", D31_LOCAL_PROVISIONAL: "1" },
    { VERCEL_ENV: "production", DELETION_POLICY_APPROVED: "true" },
    { VERCEL_ENV: "production", D31_DELETION_POLICY_APPROVED: "1" },
  ]) {
    assert.equal(createAttachmentPolicy({ env, deletionPolicyApproved: false }).releaseBlocked, true, JSON.stringify(env));
  }
  // Only the exact value true counts as approval.
  for (const value of ["true", 1, "1", {}, null, false]) {
    assert.equal(isDeletionRuleReleaseBlocked({ VERCEL_ENV: "production" }, value), true, String(value));
  }
  // After approval the same policy (not a separate mode) applies everywhere.
  const approved = createAttachmentPolicy({ env: { VERCEL_ENV: "production" } });
  assert.equal(approved.releaseBlocked, false);
  assert.equal(approved.isDeleted, hasDeletionIndicator);
  assert.equal(createAttachmentPolicy({ env: LOCAL_ENV }).isDeleted, hasDeletionIndicator, "local runs use the same check");
  const marked = { _id: 7, _attachments: [photo(UID_A, { is_deleted: true }), photo(UID_B, { is_deleted: false })] };
  assert.deepEqual(projectAuthorisedAttachments(marked, approved), [{ uid: UID_B, mimetype: "image/jpeg" }]);
});

test("H-1 and M-1: if not approved, the deletion policy is blocked in every environment except the local opt-in", () => {
  const blockedEnvs = [
    ["no environment variables", {}],
    ["null environment", null],
    ["VERCEL=1, VERCEL_ENV missing", { VERCEL: "1" }],
    ["VERCEL_ENV=production", { VERCEL_ENV: "production" }],
    ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
    ["VERCEL_ENV=prod", { VERCEL_ENV: "prod" }],
    ["VERCEL_ENV=development", { VERCEL_ENV: "development" }],
    ["opt-in with VERCEL=1", { ...LOCAL_ENV, VERCEL: "1" }],
    ["opt-in with VERCEL_ENV=production", { ...LOCAL_ENV, VERCEL_ENV: "production" }],
    ["opt-in with VERCEL_ENV=preview", { ...LOCAL_ENV, VERCEL_ENV: "preview" }],
    ["opt-in with VERCEL_ENV=prod", { ...LOCAL_ENV, VERCEL_ENV: "prod" }],
    ["opt-in with empty-looking VERCEL=0", { ...LOCAL_ENV, VERCEL: "0" }],
    ["opt-in with NODE_ENV=production", { ...LOCAL_ENV, NODE_ENV: "production" }],
    ["opt-in with NODE_ENV=staging", { ...LOCAL_ENV, NODE_ENV: "staging" }],
  ];
  for (const name of DEPLOYMENT_INDICATORS) {
    blockedEnvs.push([`opt-in with ${name}`, { ...LOCAL_ENV, [name]: "x" }]);
  }
  for (const value of ["true", "yes", "on", "01", " 1", "1 ", "TRUE", "", "0", "false", 1, true]) {
    blockedEnvs.push([`unexpected flag ${JSON.stringify(value)}`, { D31_LOCAL_PROVISIONAL: value }]);
  }
  blockedEnvs.push(["flag in lower case", { d31_local_provisional: "1" }]);

  for (const [label, env] of blockedEnvs) {
    assert.equal(isLocalProvisionalAllowed(env), false, label);
    assert.equal(isDeletionRuleReleaseBlocked(env, false), true, label);
    const policy = createAttachmentPolicy({ env, deletionPolicyApproved: false });
    assert.equal(policy.releaseBlocked, true, label);
    const rec = recordA();
    assert.equal(isAuthorisedAttachment(rec, rec._attachments[0], policy), false, label);
    assert.deepEqual(projectAuthorisedAttachments(rec, policy), [], label);
  }

  // Explicit local opt-in, with or without a local NODE_ENV.
  for (const env of [LOCAL_ENV, { ...LOCAL_ENV, NODE_ENV: "development" }, { ...LOCAL_ENV, NODE_ENV: "test" }]) {
    assert.equal(isLocalProvisionalAllowed(env), true, JSON.stringify(env));
    assert.equal(createAttachmentPolicy({ env, deletionPolicyApproved: false }).releaseBlocked, false);
  }
  // An approved policy is not blocked. This is a code
  // constant, not an environment flag: there is no Production bypass flag.
  assert.equal(isDeletionRuleReleaseBlocked({ VERCEL_ENV: "production" }, true), false);
  // An unapproved policy with no env argument is blocked.
  assert.equal(createAttachmentPolicy({ deletionPolicyApproved: false }).releaseBlocked, true);
});

test("release block (constant false): the index refuses without any Kobo request", async () => {
  for (const env of [{}, { VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { ...LOCAL_ENV, VERCEL: "1" }]) {
    const { clock, stub, index } = setup({ policy: createAttachmentPolicy({ env, deletionPolicyApproved: false }) });
    await rejectsWith(index.getFreshIndex(), "release_blocked");
    assert.equal(index.offer([recordA()], clock.now()), false);
    assert.equal(stub.calls.length, 0, JSON.stringify(env));
  }
});

// ---- Index build ----------------------------------------------------------

test("D31-T2 (index): several authorised attachments per record are all indexed", () => {
  const rec = {
    _id: 5,
    _attachments: [
      photo(UID_A, { id: 1 }),
      photo(UID_B, { id: 2, question_xpath: ORGANISATION_XPATH }),
      photo(UID_C, { id: 3 }),
      photo("attDDDDDDDDDDDDDDDDDDDDD", { id: 4, question_xpath: "other/question" }),
    ],
  };
  const idx = buildIndexFromRecords([rec], 0, POLICY);
  assert.deepEqual(idx.ids(), ["5/1", "5/2", "5/3", `5/${UID_A}`, `5/${UID_B}`, `5/${UID_C}`].sort());
  assert.equal(idx.has("5", "attDDDDDDDDDDDDDDDDDDDDD"), false);
  assert.equal(idx.has("5", "4"), false);
  assert.equal(idx.has("6", UID_A), false, "other record's sid");
});

test("D31-T21: /facilities projection and index list exactly the same IDs", () => {
  const records = [
    recordA(),
    recordB(),
    { _id: 103, _attachments: [photo(UID_C, { mimetype: "audio/mp3" }), photo("attEEEEEEEEEEEEEEEEEEEEE", { is_deleted: true })] },
    { _id: 104, _attachments: [{ id: 77, mimetype: "image/png", question_xpath: ORGANISATION_XPATH, filename: "x/y.png" }] },
    { _id: "bad", _attachments: [photo("attFFFFFFFFFFFFFFFFFFFFF")] },
    { _id: 105 },
  ];
  const idx = buildIndexFromRecords(records, 0, POLICY);
  const fromProjection = records
    .flatMap((r) => projectAuthorisedAttachments(r, POLICY).map((a) => [r._id, a]))
    .flatMap(([sid, a]) => [a.uid, a.id].filter((v) => v !== undefined).map((v) => `${sid}/${v}`))
    .sort();
  assert.deepEqual(idx.ids(), fromProjection);
  assert.deepEqual(fromProjection, ["101/1", `101/${UID_A}`, "102/2", `102/${UID_B}`, "104/77"].sort());
});

test("D31-T12: empty, malformed and emptied Kobo data are failed builds", async () => {
  assert.throws(() => buildIndexFromRecords([], 0, POLICY), { code: "empty_data" });
  assert.throws(() => buildIndexFromRecords(null, 0, POLICY), { code: "malformed_data" });
  assert.throws(() => buildIndexFromRecords({ results: [] }, 0, POLICY), { code: "malformed_data" });
  assert.throws(() => buildIndexFromRecords([recordA(), "x"], 0, POLICY), { code: "malformed_record" });
  assert.throws(() => buildIndexFromRecords([recordA(), null], 0, POLICY), { code: "malformed_record" });

  // Unknown Kobo answer shape: fetchAllKoboData returns [] (D31-IN4).
  let s = setup({ dataResponder: () => jsonPage({ unexpected: true }) });
  await rejectsWith(s.index.getFreshIndex(), "empty_data");
  assert.equal(s.index.inspect().hasIndex, false);

  // Zero records.
  s = setup({ records: [] });
  await rejectsWith(s.index.getFreshIndex(), "empty_data");

  // Malformed JSON and an error status.
  s = setup({ dataResponder: () => ({ status: 200, headers: {}, body: Buffer.from("<html>") }) });
  await rejectsWith(s.index.getFreshIndex(), "invalid_json");
  s = setup({ dataResponder: () => ({ status: 500, headers: {}, body: Buffer.alloc(0) }) });
  await rejectsWith(s.index.getFreshIndex(), "status_500");

  // Zero authorised attachments after a non-empty index.
  s = setup();
  await s.index.getFreshIndex();
  s.stub.state.records = [{ _id: 101, _attachments: [] }];
  s.clock.advance(INDEX_MAX_AGE_MS + 1);
  await rejectsWith(s.index.getFreshIndex(), "no_authorised_attachments");

  // Zero authorised attachments on a first build is a valid empty index.
  s = setup({ records: [{ _id: 1, _attachments: [] }] });
  const idx = await s.index.getFreshIndex();
  assert.equal(idx.attachmentCount, 0);
});

test("D31-T18 (index): no photo question configured gives an empty index with no Kobo request", async () => {
  const { stub, index } = setup({ policy: createAttachmentPolicy({ env: LOCAL_ENV, photoQuestionXpaths: [] }) });
  const idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), false);
  assert.equal(index.offer([recordA()], Date.now()), false);
  assert.equal(stub.calls.length, 0);
});

// ---- Single flight, age, backoff ----------------------------------------

test("D31-T7 (index): parallel cold-start calls share one build of two pages", async () => {
  const gate = gatedData();
  const { stub, index } = setup({ dataResponder: gate.responder });
  const waits = Array.from({ length: 20 }, () => index.getFreshIndex());
  await flush();
  assert.equal(gate.pending.length, 1);
  assert.equal(gate.pending[0].url, KOBO_DATA_URL);
  gate.pending[0].resolve(jsonPage({ results: [recordA()], next: PAGE2 }));
  await flush();
  assert.equal(gate.pending.length, 2);
  assert.equal(gate.pending[1].url, PAGE2);
  gate.pending[1].resolve(jsonPage({ results: [recordB()], next: null }));
  const results = await Promise.all(waits);
  assert.ok(results.every((r) => r === results[0]));
  assert.equal(results[0].has("102", UID_B), true);
  assert.equal(stub.dataCalls.length, 2);
  for (const c of stub.dataCalls) assert.equal(c.opts.headers.Authorization, `Token ${TOKEN}`);
});

test("D31-T8: index age counts from the read start; used at 300 s, rebuilt at 300 s + 1 ms", async () => {
  const gate = gatedData();
  const { clock, stub, index } = setup({ dataResponder: gate.responder });
  const t0 = clock.now();
  const first = index.getFreshIndex();
  await flush();
  clock.advance(10_000); // the read takes 10 s
  gate.pending[0].resolve(jsonPage({ results: [recordA()], next: null }));
  const idx = await first;
  assert.equal(idx.readStartedAt, t0, "age starts at the read start, not the read end");

  clock.advance(INDEX_MAX_AGE_MS - 10_000); // exactly 300 s after the read start
  assert.equal(await index.getFreshIndex(), idx);
  assert.equal(stub.dataCalls.length, 1);

  clock.advance(1); // 300 s + 1 ms
  const second = index.getFreshIndex();
  await flush();
  assert.equal(stub.dataCalls.length, 2, "a new build started");
  gate.pending[1].resolve(jsonPage({ results: [recordA()], next: null }));
  const idx2 = await second;
  assert.notEqual(idx2, idx);
  assert.equal(idx2.readStartedAt, t0 + INDEX_MAX_AGE_MS + 1);
});

test("D31-T9 and D31-T10: expired index plus failed build is unavailable; 30 s backoff with no Kobo request", async () => {
  let fail = false;
  const { clock, stub, index } = setup({
    dataResponder: (url, opts, n, state) =>
      fail ? { status: 502, headers: {}, body: Buffer.alloc(0) } : jsonPage({ results: state.records, next: null }),
  });
  const idx = await index.getFreshIndex();
  assert.equal(stub.dataCalls.length, 1);

  // Expired index and a failed refresh: never fall back to the old index.
  fail = true;
  clock.advance(INDEX_MAX_AGE_MS + 1);
  await rejectsWith(index.getFreshIndex(), "status_502");
  assert.equal(stub.dataCalls.length, 2);
  assert.equal(index.inspect().readStartedAt, idx.readStartedAt, "old index kept but not used");

  // Inside the backoff period: unavailable, no Kobo request.
  clock.advance(INDEX_RETRY_BACKOFF_MS - 1);
  await rejectsWith(index.getFreshIndex(), "backoff");
  await rejectsWith(index.getFreshIndex(), "backoff");
  assert.equal(stub.dataCalls.length, 2);

  // After 30 s: exactly one new build.
  fail = false;
  clock.advance(1);
  const fresh = await index.getFreshIndex();
  assert.equal(stub.dataCalls.length, 3);
  assert.ok(fresh.readStartedAt > idx.readStartedAt);
  assert.equal(index.inspect().lastFailureAt, null);
});

test("D31-T9: a missing token is a failed build with no Kobo request", async () => {
  const { stub, index } = setup({ getToken: () => undefined });
  await rejectsWith(index.getFreshIndex(), "missing_token");
  assert.equal(stub.calls.length, 0);
});

// ---- Deadline, cancellation, late results --------------------------------

test("D31-T11 and D31-T25: 25 s deadline; per-page time limit never exceeds the time left; no page after the deadline", async () => {
  const gate = gatedData();
  const { clock, stub, index, lines } = setup({ dataResponder: gate.responder });
  const wait = index.getFreshIndex();
  await flush();
  assert.equal(gate.pending.length, 1);
  assert.equal(gate.pending[0].opts.timeoutMs, INDEX_PAGE_TIMEOUT_MS, "first page: min(10 s, 25 s)");

  clock.advance(20_000);
  gate.pending[0].resolve(jsonPage({ results: [recordA()], next: PAGE2 }));
  await flush();
  assert.equal(gate.pending.length, 2);
  assert.equal(gate.pending[1].opts.timeoutMs, 5_000, "second page: min(10 s, 5 s left)");

  clock.advance(4_999);
  await flush();
  assert.equal(index.inspect().building, true, "still inside the deadline");
  clock.advance(1); // 25 s after the read start
  await rejectsWith(wait, "build_deadline");
  assert.equal(index.inspect().building, false, "single-flight slot cleared");
  assert.equal(index.inspect().hasIndex, false);

  // The in-flight page answers late with a `next` link: no further page starts.
  gate.pending[1].resolve(jsonPage({ results: [recordB()], next: `${PAGE2.replace("1000&start=1000", "1000&start=2000")}` }));
  await flush();
  await flush();
  assert.equal(stub.dataCalls.length, 2);
  assert.equal(index.inspect().hasIndex, false);
  assert.match(lines.join("\n"), /build_failed code=build_deadline/);

  // The deadline failure starts the backoff.
  await rejectsWith(index.getFreshIndex(), "backoff");
  assert.equal(stub.dataCalls.length, 2);
});

test("D31-T25: no page request starts once the deadline time has passed", async () => {
  // The clock moves past the deadline while page 1 is in flight, before the
  // deadline timer runs. The guard stops page 2 before it is sent.
  // Page 1 waits for the test; any later page answers at once, so a page
  // request after the deadline would complete the build and fail the test.
  const gate = gatedData();
  const clock = fakeClock();
  const stub = koboStub({
    dataResponder: (url, opts, n) =>
      n === 1 ? gate.responder(url, opts) : jsonPage({ results: [recordB()], next: null }),
  });
  const { log } = captureLog();
  const timers = [];
  const index = createAttachmentIndex({
    get: stub.get,
    getToken: () => TOKEN,
    policy: POLICY,
    now: clock.now,
    setTimer: (fn) => (timers.push(fn), () => {}), // deadline timer never fires on its own
    log,
  });
  const wait = index.getFreshIndex();
  await flush();
  clock.advance(INDEX_BUILD_TIMEOUT_MS);
  gate.pending[0].resolve(jsonPage({ results: [recordA()], next: PAGE2 }));
  await rejectsWith(wait, "build_deadline");
  assert.equal(stub.dataCalls.length, 1);
});

test("D31-T26: an abandoned build that resolves later does not install its result", async () => {
  const gate = gatedData();
  const { clock, index, lines } = setup({ dataResponder: gate.responder });
  const wait = index.getFreshIndex();
  await flush();
  clock.advance(INDEX_BUILD_TIMEOUT_MS);
  await rejectsWith(wait, "build_deadline");
  gate.pending[0].resolve(jsonPage({ results: [recordA()], next: null }));
  await flush();
  await flush();
  assert.equal(index.inspect().hasIndex, false);
  assert.match(lines.join("\n"), /late_result_dropped/);
});

test("D31-T14: an older result never replaces a newer index", async () => {
  const gate = gatedData();
  const { clock, index } = setup({ dataResponder: gate.responder });
  const t0 = clock.now();
  const wait = index.getFreshIndex(); // build reads from t0
  await flush();
  clock.advance(1_000);
  // /facilities read that started later (t0 + 500) offers newer data.
  const newer = [{ _id: 101, _attachments: [photo(UID_C)] }];
  assert.equal(index.offer(newer, t0 + 500), true);
  // The older build now completes with older content.
  gate.pending[0].resolve(jsonPage({ results: [recordA()], next: null }));
  const idx = await wait;
  assert.equal(idx.readStartedAt, t0 + 500);
  assert.equal(idx.has("101", UID_C), true);
  assert.equal(idx.has("101", UID_A), false);
  // An even older offer is refused.
  assert.equal(index.offer([recordA()], t0 + 100), false);
  assert.equal(index.inspect().readStartedAt, t0 + 500);
});

test("L-1: waiters of a failing build get a fresh offered index; no backoff starts", async () => {
  for (const failure of ["deadline", "error"]) {
    const gate = gatedData();
    const { clock, stub, index, lines } = setup({ dataResponder: gate.responder });
    const t0 = clock.now();
    const waits = [index.getFreshIndex(), index.getFreshIndex()];
    await flush();
    assert.equal(gate.pending.length, 1, "single flight");
    clock.advance(1_000);
    const offered = [{ _id: 101, _attachments: [photo(UID_C)] }];
    assert.equal(index.offer(offered, t0 + 500), true);
    if (failure === "deadline") clock.advance(INDEX_BUILD_TIMEOUT_MS);
    else gate.pending[0].resolve({ status: 502, headers: {}, body: Buffer.alloc(0) });
    const results = await Promise.all(waits);
    for (const idx of results) {
      assert.equal(idx.readStartedAt, t0 + 500, failure);
      assert.equal(idx.has("101", UID_C), true);
    }
    assert.equal(index.inspect().lastFailureAt, null, "no backoff");
    assert.equal(index.inspect().building, false);
    assert.match(lines.join("\n"), /build_failed_fresh_index_used/);
    // The failed build result is never installed, also if it arrives later.
    if (failure === "deadline") {
      gate.pending[0].resolve(jsonPage({ results: [recordA()], next: null }));
      await flush();
      await flush();
    }
    assert.equal((await index.getFreshIndex()).has("101", UID_A), false);
    assert.equal(stub.dataCalls.length, 1);
  }
});

test("L-1 control: a failing build with no fresh index still gives 503 and backoff", async () => {
  const gate = gatedData();
  const { clock, index } = setup({ dataResponder: gate.responder });
  const wait = index.getFreshIndex();
  await flush();
  clock.advance(1_000);
  assert.equal(index.offer([recordA()], clock.now() - INDEX_MAX_AGE_MS - 1), false, "stale offer refused");
  gate.pending[0].resolve({ status: 502, headers: {}, body: Buffer.alloc(0) });
  await rejectsWith(wait, "status_502");
  await rejectsWith(index.getFreshIndex(), "backoff");
});

test("L-2: a completed build that is not fresh is a failed build with backoff", async () => {
  // Case 1: the read takes longer than the maximum age (short test limit).
  {
    const gate = gatedData();
    const { clock, stub, index } = setup({ dataResponder: gate.responder, maxAgeMs: 1_000 });
    const wait = index.getFreshIndex();
    await flush();
    clock.advance(2_000);
    gate.pending[0].resolve(jsonPage({ results: [recordA()], next: null }));
    await rejectsWith(wait, "stale_result");
    assert.notEqual(index.inspect().lastFailureAt, null);
    await rejectsWith(index.getFreshIndex(), "backoff");
    await rejectsWith(index.getFreshIndex(), "backoff");
    assert.equal(stub.dataCalls.length, 1, "no immediate repeated Kobo read");
  }
  // Case 2: the clock steps back below the read start of the installed index.
  {
    const { clock, stub, index } = setup();
    await index.getFreshIndex();
    clock.advance(-60_000);
    await rejectsWith(index.getFreshIndex(), "stale_result");
    for (let i = 0; i < 5; i += 1) await rejectsWith(index.getFreshIndex(), "backoff");
    assert.equal(stub.dataCalls.length, 2, "one read, then backoff");
    clock.advance(INDEX_RETRY_BACKOFF_MS);
    await rejectsWith(index.getFreshIndex(), "stale_result");
    assert.equal(stub.dataCalls.length, 3, "at most one read per backoff period");
  }
});

test("Scope item 10 (offer): /facilities reads populate the index only when fresh and valid", async () => {
  const { clock, stub, index } = setup();
  const t = clock.now();
  assert.equal(index.offer([recordA()], t - INDEX_MAX_AGE_MS - 1), false, "too old");
  assert.equal(index.offer([recordA()], t + 1), false, "from the future");
  assert.equal(index.offer([], t), false, "empty");
  assert.equal(index.offer("x", t), false, "malformed");
  assert.equal(index.offer([recordA()], Number.NaN), false);
  assert.equal(index.offer([recordA()], t), true);
  const idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), true);
  assert.equal(stub.calls.length, 0, "the offered read saved a Kobo read");
  // The offered index expires on the same rule.
  clock.advance(INDEX_MAX_AGE_MS + 1);
  await index.getFreshIndex();
  assert.equal(stub.dataCalls.length, 1);
  // An offer that empties a non-empty index is refused.
  assert.equal(index.offer([{ _id: 101, _attachments: [] }], clock.now()), false);
});

test("D31-T13 and D31-T24 (index): deletion and restoration follow the next build", async () => {
  const { clock, stub, index } = setup();
  let idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), true);

  // Kobo removes the attachment. The refresh completes before membership.
  stub.state.records = [{ _id: 101, _attachments: [] }, recordB()];
  clock.advance(INDEX_MAX_AGE_MS + 1);
  idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), false);

  // Kobo restores it.
  stub.state.records = [recordA(), recordB()];
  clock.advance(INDEX_MAX_AGE_MS + 1);
  idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), true);

  // A positive marker (simulated) removes it; the marker cleared restores it.
  stub.state.records = [{ _id: 101, _attachments: [photo(UID_A, { is_deleted: true })] }, recordB()];
  clock.advance(INDEX_MAX_AGE_MS + 1);
  idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), false);
  stub.state.records = [{ _id: 101, _attachments: [photo(UID_A, { is_deleted: false })] }, recordB()];
  clock.advance(INDEX_MAX_AGE_MS + 1);
  idx = await index.getFreshIndex();
  assert.equal(idx.has("101", UID_A), true);
  assert.equal(stub.dataCalls.length, 5);
});

test("D31-T16 (index): the index sends only data-page GETs and holds no record content", async () => {
  const { stub, index } = setup();
  const idx = await index.getFreshIndex();
  assert.ok(stub.calls.every((c) => c.url.startsWith(KOBO_DATA_URL.split("?")[0])));
  assert.deepEqual(Object.keys(idx).sort(), ["attachmentCount", "has", "ids", "readStartedAt", "recordMarkerRefusals"]);
  assert.ok(Object.isFrozen(idx));
});

test("D31-T16 (index, real guardedGet): every index request is sent with method GET", async () => {
  const PAGE1 = { results: [recordA()], next: PAGE2 };
  const { transport, requests } = recordingTransport((url) =>
    jsonPage(url === KOBO_DATA_URL ? PAGE1 : { results: [recordB()], next: null }),
  );
  const index = createAttachmentIndex({
    get: createGuardedGet({ transport }),
    getToken: () => TOKEN,
    policy: POLICY,
    log: captureLog().log,
  });
  const idx = await index.getFreshIndex();
  assert.equal(idx.has("102", UID_B), true);
  assert.equal(requests.length, 2);
  for (const r of requests) {
    assert.equal(r.method, "GET");
    assert.ok(isDataPageUrl(r.url));
  }
});
