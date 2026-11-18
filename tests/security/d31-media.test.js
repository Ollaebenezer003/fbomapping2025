// D31 end-to-end tests through the Express app on 127.0.0.1, with a stub
// Kobo. No external network access. Synthetic records only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KOBO_ASSET_UID, KOBO_DATA_PATH, KOBO_ORIGIN } from "../../api/_lib/kobo.js";
import { INDEX_MAX_AGE_MS, INDEX_RETRY_BACKOFF_MS } from "../../api/_lib/attachmentIndex.js";
import { DEPLOYMENT_INDICATORS } from "../../api/_lib/deletionPolicy.js";
import { createGuardedGet } from "../../api/_lib/safeHttp.js";
import {
  API_KEY, FACILITY_XPATH, JPEG, LOCAL_ENV, ORGANISATION_XPATH, TOKEN,
  captureLog, fakeClock, fetchAll, isDataPageUrl, jsonPage, koboStub, ok, photo, recordingTransport, startApp,
} from "./helpers.js";

const ENV = Object.freeze({ KOBO_TOKEN: TOKEN, API_KEY, ...LOCAL_ENV });
const ALLOWED_ORIGIN = "https://fbomapping2025.vercel.app";
const SID = "424242";
const UID_1 = "attFacilityPhoto00000001";
const UID_2 = "attOrganisationPhoto0002";
const UID_3 = "attFacilityPhoto00000003";
const SIZES = ["small", "medium", "large"];
const LEGACY_KEY = "SENTINEL_LEGACY_KEY_5d1e";

const ATTACHMENT_BASE = `${KOBO_ORIGIN}/api/v2/assets/${KOBO_ASSET_UID}/data/`;
const attachmentUrl = (sid, aid, size) => `${ATTACHMENT_BASE}${sid}/attachments/${aid}/${size}/`;
const idsPath = (sid, aid, size = "small") => `/media?${new URLSearchParams({ sid, aid, size })}`;
const legacyPath = (sid, aid, size = "small", extra = "") =>
  `/media?url=${encodeURIComponent(attachmentUrl(sid, aid, size))}${extra}`;

// Rejected attachments sit beside approved ones in synthetic records.
const NON_IMAGE = "attNonImageAttachment001";
const NO_TYPE = "attNoMimetypeAttachment1";
const WRONG_Q = "attWrongQuestionPhoto001";
const NO_Q = "attNoQuestionXpathPhoto1";
const MARKED = "attDeleteMarkedPhoto0001";
const OTHER_SID = "777";
const OTHER_UID = "attOtherRecordPhoto00001";

function records() {
  return [
    {
      _id: Number(SID),
      "fbo_details/name_of_facility": "Synthetic_Facility",
      _attachments: [
        photo(UID_1, { id: 11, filename: "synthetic/attachments/a.jpg", download_url: attachmentUrl(SID, UID_1, "small") }),
        photo(UID_2, { id: 12, question_xpath: ORGANISATION_XPATH, download_large_url: attachmentUrl(SID, UID_2, "large") }),
        photo(UID_3, { id: 13, is_deleted: false }),
        photo(NON_IMAGE, { id: 14, mimetype: "audio/mp3" }),
        { uid: NO_TYPE, id: 15, question_xpath: FACILITY_XPATH },
        photo(WRONG_Q, { id: 16, question_xpath: "consent/signature" }),
        { uid: NO_Q, id: 17, mimetype: "image/jpeg" },
        photo(MARKED, { id: 18, is_deleted: true }),
      ],
    },
    { _id: Number(OTHER_SID), _attachments: [photo(OTHER_UID, { id: 19 })] },
    { _id: 778, "fbo_details/name_of_facility": "No_Photos" },
  ];
}

/**
 * One app with a manual clock; several requests share its index. Each
 * session keeps its own responses, so no test depends on another test.
 */
async function session({ env = ENV, recs = records(), dataResponder, imageResponder, policyOptions, get } = {}) {
  const clock = fakeClock();
  const stub = koboStub({ records: recs, dataResponder, imageResponder });
  const { log, lines } = captureLog();
  const app = await startApp({
    get: get ?? stub.get, env, log, now: clock.now, indexOptions: { setTimer: clock.setTimer }, policyOptions,
  });
  const responses = [];
  const request = async (path, init = {}) => {
    const res = await fetchAll(await fetch(app.base + path, { redirect: "manual", ...init }));
    responses.push(res);
    return res;
  };
  return { clock, stub, lines, responses, request, close: () => app.close() };
}

function assertNoStoreError(res, status) {
  assert.equal(res.status, status);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(Object.keys(JSON.parse(res.body.toString())), ["error"]);
}

test("D31-T1: every authorised attachment serves small, medium and large, by uid and numeric id", async () => {
  const s = await session();
  try {
    for (const aid of [UID_1, "11"]) {
      for (const size of SIZES) {
        const res = await s.request(idsPath(SID, aid, size));
        assert.equal(res.status, 200, `${aid} ${size}`);
        assert.equal(res.headers["cache-control"], "private, max-age=300");
        assert.equal(res.headers["content-security-policy"], "default-src 'none'; sandbox");
        assert.equal(res.headers["content-disposition"], 'inline; filename="photo.jpg"');
        assert.equal(s.stub.imageCalls.at(-1).url, attachmentUrl(SID, aid, size));
      }
    }
    assert.equal(s.stub.dataCalls.length, 1, "one index build serves every request");
    assert.equal(s.stub.imageCalls.length, 6);
    assert.equal(s.responses.length, 6);
    for (const res of s.responses) {
      assert.doesNotMatch(String(res.headers["cache-control"]), /s-maxage|public/);
    }
  } finally {
    await s.close();
  }
});

test("D31-T2: several photos in one facility are all served (no one-photo limit)", async () => {
  const s = await session();
  try {
    for (const aid of [UID_1, UID_2, UID_3, "12", "13"]) {
      for (const size of SIZES) assert.equal((await s.request(idsPath(SID, aid, size))).status, 200, aid);
    }
  } finally {
    await s.close();
  }
});

test("D31-T3 and D31-T27: rejected attachments and fresh misses give 404 with no upstream request", async () => {
  const s = await session();
  try {
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 200); // warm the index
    const before = s.stub.calls.length;
    for (const [sid, aid] of [
      [SID, NON_IMAGE], [SID, "14"],
      [SID, NO_TYPE], [SID, "15"],
      [SID, WRONG_Q], [SID, "16"],
      [SID, NO_Q], [SID, "17"],
      [SID, MARKED], [SID, "18"],
      [SID, OTHER_UID], // another record's attachment
      [OTHER_SID, UID_1],
      ["999999", UID_1], // unknown record
      [SID, "attNeverExisted000000001"],
      [SID, "99999"],
    ]) {
      for (const path of [idsPath(sid, aid), legacyPath(sid, aid), legacyPath(sid, aid, "large", `&key=${LEGACY_KEY}`)]) {
        assertNoStoreError(await s.request(path), 404);
      }
    }
    assert.equal(s.stub.calls.length, before, "no data read and no image request for a fresh miss");
  } finally {
    await s.close();
  }
});

test("D31-T4: an index miss never starts a build", async () => {
  const s = await session();
  try {
    await s.request(idsPath(SID, UID_1));
    s.clock.advance(INDEX_MAX_AGE_MS); // still fresh (exactly 300 s)
    assertNoStoreError(await s.request(idsPath(SID, "attNeverExisted000000001")), 404);
    assert.equal(s.stub.dataCalls.length, 1);
  } finally {
    await s.close();
  }
});

test("D31-T5: strict query keys; rejected with no Kobo request of any kind", async () => {
  const s = await session();
  try {
    const ids = `sid=${SID}&aid=${UID_1}&size=small`;
    const url = `url=${encodeURIComponent(attachmentUrl(SID, UID_1, "small"))}`;
    for (const query of [
      `${ids}&x=1`, // unknown key
      `${ids}&cb=123`,
      `${ids}&sid=${SID}`, // repeated key
      `${url}&${url}`,
      `${url}&key=a&key=b`,
      `${ids}&${url}`, // mixed forms
      `${ids}&key=${LEGACY_KEY}`, // key with the new form
      `sid[]=${SID}&aid=${UID_1}&size=small`, // bracket keys
      `sid=${SID}&aid=${UID_1}&size=small&a[b]=1`,
      `${url}&url[]=x`,
      `=1&${ids}`, // empty key
      `${ids}&=`,
      `${ids}&${"z".repeat(2300)}=1`, // long query
      `key=${LEGACY_KEY}`, // key alone
      `sid=${SID}&aid=${UID_1}`, // missing key
      "",
      `SID=${SID}&aid=${UID_1}&size=small`, // case matters
      `sid=${SID}&aid=${UID_1}&size=small&sid%5B%5D=1`,
    ]) {
      const res = await s.request(`/media?${query}`);
      assertNoStoreError(res, 400);
    }
    assert.equal(s.stub.calls.length, 0);
  } finally {
    await s.close();
  }
});

test("D31-T6: legacy url= works only through the index", async () => {
  const s = await session();
  try {
    for (const size of SIZES) {
      for (const extra of ["", `&key=${LEGACY_KEY}`]) {
        const res = await s.request(legacyPath(SID, UID_1, size, extra));
        assert.equal(res.status, 200);
        assert.equal(s.stub.imageCalls.at(-1).url, attachmentUrl(SID, UID_1, size));
      }
    }
    // Key order does not matter.
    assert.equal((await s.request(`/media?key=${LEGACY_KEY}&url=${encodeURIComponent(attachmentUrl(SID, UID_2, "medium"))}`)).status, 200);
    // Valid form, not indexed.
    assertNoStoreError(await s.request(legacyPath(SID, WRONG_Q)), 404);
    // Not canonical.
    const before = s.stub.calls.length;
    for (const raw of [
      `https://evil.example/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID_1}/small/`,
      attachmentUrl(SID, UID_1, "original"),
      attachmentUrl(SID, UID_1, "small").replace("https://", "http://"),
      `${attachmentUrl(SID, UID_1, "small")}?format=json&x=1`,
    ]) {
      assertNoStoreError(await s.request(`/media?url=${encodeURIComponent(raw)}`), 400);
    }
    assert.equal(s.stub.calls.length, before);
  } finally {
    await s.close();
  }
});

test("D31-T7: 20 parallel cold-start requests make exactly one build of 2 pages", async () => {
  const page2 = `${KOBO_ORIGIN}${KOBO_DATA_PATH}?format=json&limit=1000&start=1000`;
  const [first, ...rest] = records();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const s = await session({
    dataResponder: async (url) => {
      await gate;
      return url === page2 ? jsonPage({ results: rest, next: null }) : jsonPage({ results: [first], next: page2 });
    },
  });
  try {
    const all = Array.from({ length: 20 }, (_, i) => s.request(idsPath(i % 2 ? SID : OTHER_SID, i % 2 ? UID_1 : OTHER_UID, SIZES[i % 3])));
    await new Promise((resolve) => setTimeout(resolve, 100)); // let every request reach the index
    release();
    const results = await Promise.all(all);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(s.stub.dataCalls.length, 2);
    assert.equal(s.stub.imageCalls.length, 20);
  } finally {
    await s.close();
  }
});

test("D31-T8, D31-T9, D31-T10: expiry, rebuild, failed refresh and backoff through /media", async () => {
  let fail = false;
  const s = await session({
    dataResponder: (url, opts, n, state) =>
      fail ? { status: 500, headers: {}, body: Buffer.alloc(0) } : jsonPage({ results: state.records, next: null }),
  });
  try {
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 200);
    s.clock.advance(INDEX_MAX_AGE_MS);
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 200);
    assert.equal(s.stub.dataCalls.length, 1);

    s.clock.advance(1);
    fail = true;
    const images = s.stub.imageCalls.length;
    assertNoStoreError(await s.request(idsPath(SID, UID_1)), 503);
    assert.equal(s.stub.dataCalls.length, 2);
    assert.equal(s.stub.imageCalls.length, images, "no image request without a fresh index");
    // Fresh misses are not answered from the expired index either.
    assertNoStoreError(await s.request(idsPath(SID, "attNeverExisted000000001")), 503);
    assert.equal(s.stub.dataCalls.length, 2, "backoff: no Kobo request");

    s.clock.advance(INDEX_RETRY_BACKOFF_MS - 1); // 29.999 s after the failure
    assertNoStoreError(await s.request(legacyPath(SID, UID_1)), 503);
    assert.equal(s.stub.dataCalls.length, 2);

    fail = false;
    s.clock.advance(1);
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 200);
    assert.equal(s.stub.dataCalls.length, 3);
    assert.match(s.lines.join("\n"), /index_unavailable code=status_500/);
    assert.match(s.lines.join("\n"), /index_unavailable code=backoff/);
  } finally {
    await s.close();
  }
});

test("D31-T11: a stalled build gives 503 at the deadline", async () => {
  const s = await session({ dataResponder: () => new Promise(() => {}) });
  try {
    const pending = s.request(idsPath(SID, UID_1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(s.stub.dataCalls[0].opts.timeoutMs, 10_000);
    s.clock.advance(25_000);
    assertNoStoreError(await pending, 503);
    assert.equal(s.stub.imageCalls.length, 0);
    assert.match(s.lines.join("\n"), /index_unavailable code=build_deadline/);
  } finally {
    await s.close();
  }
});

test("D31-T12: empty or malformed Kobo data gives 503", async () => {
  for (const dataResponder of [
    () => jsonPage({ results: [], next: null }),
    () => jsonPage({ unexpected: true }),
    () => jsonPage({ results: ["not a record"], next: null }),
    () => ({ status: 200, headers: {}, body: Buffer.from("not json") }),
  ]) {
    const s = await session({ dataResponder });
    try {
      assertNoStoreError(await s.request(idsPath(SID, UID_1)), 503);
      assert.equal(s.stub.imageCalls.length, 0);
    } finally {
      await s.close();
    }
  }
});

test("D31-T13 and D31-T24: deletion and restoration simulations through /media", async () => {
  const s = await session();
  try {
    assert.equal((await s.request(idsPath(SID, UID_1, "large"))).status, 200);

    // Kobo removes the attachment from _attachments.
    s.stub.state.records = records().map((r) =>
      r._id === Number(SID) ? { ...r, _attachments: r._attachments.filter((a) => a.uid !== UID_1) } : r,
    );
    s.clock.advance(INDEX_MAX_AGE_MS + 1);
    const images = s.stub.imageCalls.length;
    assertNoStoreError(await s.request(idsPath(SID, UID_1, "large")), 404);
    assert.equal(s.stub.dataCalls.length, 2, "refresh happened before the membership check");
    assert.equal(s.stub.imageCalls.length, images, "no image request for the removed attachment");
    assert.equal((await s.request(idsPath(SID, UID_2))).status, 200, "other photos unaffected");

    // Kobo restores it.
    s.stub.state.records = records();
    s.clock.advance(INDEX_MAX_AGE_MS + 1);
    assert.equal((await s.request(idsPath(SID, UID_1, "large"))).status, 200);

    // Simulated positive marker, then cleared.
    s.stub.state.records = records().map((r) =>
      r._id === Number(SID)
        ? { ...r, _attachments: r._attachments.map((a) => (a.uid === UID_1 ? { ...a, is_deleted: true } : a)) }
        : r,
    );
    s.clock.advance(INDEX_MAX_AGE_MS + 1);
    assertNoStoreError(await s.request(legacyPath(SID, UID_1)), 404);
    s.stub.state.records = records();
    s.clock.advance(INDEX_MAX_AGE_MS + 1);
    assert.equal((await s.request(legacyPath(SID, UID_1))).status, 200);

    // Upstream 410 (Kobo removed the file after the index build) gives 404.
    const s410 = await session({ imageResponder: () => ({ status: 410, headers: {}, body: Buffer.alloc(0) }) });
    try {
      assertNoStoreError(await s410.request(idsPath(SID, UID_1)), 404);
    } finally {
      await s410.close();
    }
  } finally {
    await s.close();
  }
});

test("OPS-070: Production deletion policy through /media and /facilities with mocked Kobo responses", async () => {
  const PROD = Object.freeze({ KOBO_TOKEN: TOKEN, API_KEY, VERCEL: "1", VERCEL_ENV: "production" });
  const mutate = (fn) =>
    records().map((r) => (r._id === Number(SID) ? { ...r, _attachments: r._attachments.map(fn) } : r));

  // If the constant were false: Production serves no photo, with no Kobo request.
  const blocked = await session({ env: PROD, policyOptions: { deletionPolicyApproved: false } });
  try {
    assertNoStoreError(await blocked.request(idsPath(SID, UID_1)), 503);
    assert.equal(blocked.stub.calls.length, 0);
  } finally {
    await blocked.close();
  }

  // OD-21: the default (the real code constant) is approved in Production.
  const s = await session({ env: PROD });
  try {
    // A public request cannot change the gate or the policy.
    assertNoStoreError(await s.request(`${idsPath(SID, MARKED)}&DELETION_POLICY_APPROVED=false`), 400);
    assertNoStoreError(await s.request(`${idsPath(SID, MARKED)}&releaseBlocked=false&isDeleted=false`), 400);
    assertNoStoreError(
      await s.request(idsPath(SID, MARKED), { headers: { "X-Deletion-Policy-Approved": "true", "X-D31-Local-Provisional": "1" } }),
      404,
    );
    const tampered = JSON.parse(
      (await s.request(`/facilities?key=${API_KEY}&DELETION_POLICY_APPROVED=false&D31_LOCAL_PROVISIONAL=1`)).body.toString(),
    );
    const tamperedIds = tampered.find((r) => r._id === Number(SID))._attachments.map((a) => a.uid);
    assert.deepEqual(tamperedIds, [UID_1, UID_2, UID_3], "gate unchanged; marked photo still refused");

    assert.equal((await s.request(idsPath(SID, UID_1, "large"))).status, 200, "active photo served");
    assert.equal((await s.request(idsPath(SID, UID_3))).status, 200, "is_deleted=false with membership is served");
    assertNoStoreError(await s.request(idsPath(SID, MARKED)), 404);
    assertNoStoreError(await s.request(idsPath(SID, "18")), 404);

    const steps = [
      ["explicit marker", () => mutate((a) => (a.uid === UID_1 ? { ...a, is_deleted: true } : a))],
      ["string marker", () => mutate((a) => (a.uid === UID_1 ? { ...a, is_deleted: "false" } : a))],
      ["null marker", () => mutate((a) => (a.uid === UID_1 ? { ...a, is_deleted: null } : a))],
      ["other deletion key", () => mutate((a) => (a.uid === UID_1 ? { ...a, deleted_at: "2026-11-17T00:00:00Z" } : a))],
      ["false marker with other key", () => mutate((a) => (a.uid === UID_1 ? { ...a, is_deleted: false, in_trash: false } : a))],
      ["duplicate uid on a deleted entry", () => [
        ...records().map((r) => (r._id === Number(SID) ? { ...r, _attachments: [...r._attachments, photo(UID_1, { id: 99, is_deleted: true })] } : r)),
      ]],
      ["record deletion key", () => records().map((r) => (r._id === Number(SID) ? { ...r, _deleted_at: "x" } : r))],
      ["missing from the fresh read", () => mutate((a) => a).map((r) =>
        r._id === Number(SID) ? { ...r, _attachments: r._attachments.filter((a) => a.uid !== UID_1) } : r)],
    ];
    for (const [label, build] of steps) {
      s.stub.state.records = build();
      s.clock.advance(INDEX_MAX_AGE_MS + 1);
      const images = s.stub.imageCalls.length;
      for (const aid of [UID_1, "11"]) assertNoStoreError(await s.request(idsPath(SID, aid, "medium")), 404);
      assertNoStoreError(await s.request(legacyPath(SID, UID_1)), 404);
      assert.equal(s.stub.imageCalls.length, images, `${label}: no image request`);
      const body = JSON.parse((await s.request(`/facilities?key=${API_KEY}`)).body.toString());
      const listed = body.find((r) => r._id === Number(SID))._attachments.map((a) => a.uid);
      assert.ok(!listed.includes(UID_1), `${label}: not listed`);
      // Control: restore, then the photo is served again.
      s.stub.state.records = records();
      s.clock.advance(INDEX_MAX_AGE_MS + 1);
      assert.equal((await s.request(idsPath(SID, UID_1))).status, 200, `${label}: restored control`);
    }

    // The build log has counts only.
    const built = s.lines.filter((l) => l.includes("[index] built"));
    assert.ok(built.length > 0);
    for (const line of built) assert.match(line, /^info \[index\] built ids=\d+ record_marker_refusals=\d+$/);
    assert.ok(built.some((l) => l.endsWith("record_marker_refusals=1")), "P-5 refusal is counted");

    // An expired index is never used: a failed refresh gives 503 with no image request.
    s.stub.state.records = "not an array";
    s.clock.advance(INDEX_MAX_AGE_MS + 1);
    const images = s.stub.imageCalls.length;
    assertNoStoreError(await s.request(idsPath(SID, UID_1)), 503);
    assertNoStoreError(await s.request(idsPath(SID, UID_2)), 503);
    assert.equal(s.stub.imageCalls.length, images);

    // No credential in any response or log line.
    for (const res of s.responses) assert.ok(!res.body.toString().includes(TOKEN));
    for (const res of s.responses) assert.ok(!JSON.stringify(res.headers).includes(TOKEN));
    assert.ok(!s.lines.join("\n").includes(TOKEN));
    // The token is sent only in the Authorization header of Kobo requests.
    for (const call of s.stub.calls) {
      assert.ok(!call.url.includes(TOKEN));
      assert.equal(call.opts.headers?.Authorization, `Token ${TOKEN}`);
    }
  } finally {
    await s.close();
  }
});

test("D31-T15: kill switch and missing token: no index build and no Kobo request", async () => {
  for (const env of [{ ...ENV, MEDIA_PROXY_ENABLED: "false" }, { API_KEY, ...LOCAL_ENV }]) {
    const s = await session({ env });
    try {
      assertNoStoreError(await s.request(idsPath(SID, UID_1)), 503);
      assert.equal(s.stub.calls.length, 0);
    } finally {
      await s.close();
    }
  }
});

test("D31-T17 and D31-T21: /facilities lists only authorised attachments with uid, id and mimetype", async () => {
  const s = await session();
  try {
    const res = await s.request(`/facilities?key=${API_KEY}`);
    assert.equal(res.status, 200);
    const text = res.body.toString();
    assert.doesNotMatch(text, /download_|filename|question_xpath|kobotoolbox|https?:|is_deleted/);
    const body = JSON.parse(text);
    const rec = body.find((r) => r._id === Number(SID));
    assert.deepEqual(rec._attachments, [
      { uid: UID_1, id: 11, mimetype: "image/jpeg" },
      { uid: UID_2, id: 12, mimetype: "image/jpeg" },
      { uid: UID_3, id: 13, mimetype: "image/jpeg" },
    ]);
    assert.equal(rec["fbo_details/name_of_facility"], "Synthetic Facility", "other fields unchanged (choice mapping)");
    assert.deepEqual(body.find((r) => r._id === Number(OTHER_SID))._attachments, [{ uid: OTHER_UID, id: 19, mimetype: "image/jpeg" }]);
    assert.equal(Object.hasOwn(body.find((r) => r._id === 778), "_attachments"), false, "absent stays absent");
    for (const r of body) {
      for (const a of r._attachments ?? []) assert.deepEqual(Object.keys(a).sort(), ["id", "mimetype", "uid"]);
    }

    // Scope item 10: the /facilities read populated the index; every listed
    // ID is served with no further data read (same rule, D31-T21).
    const dataReads = s.stub.dataCalls.length;
    for (const r of body) {
      for (const a of r._attachments ?? []) {
        for (const aid of [a.uid, String(a.id)]) {
          assert.equal((await s.request(idsPath(String(r._id), aid))).status, 200, `${r._id}/${aid}`);
        }
      }
    }
    assert.equal(s.stub.dataCalls.length, dataReads, "fresh /facilities read reused by the index");
    // Edge cache header for /facilities is unchanged.
    assert.equal(res.headers["cache-control"], "public, max-age=0, s-maxage=300, stale-while-revalidate=300");
  } finally {
    await s.close();
  }
});

test("D31-T18: no photo question configured: no attachments listed, 404 with no Kobo request", async () => {
  const s = await session({ policyOptions: { photoQuestionXpaths: [] } });
  try {
    assertNoStoreError(await s.request(idsPath(SID, UID_1)), 404);
    assert.equal(s.stub.calls.length, 0);
    const body = JSON.parse((await s.request(`/facilities?key=${API_KEY}`)).body.toString());
    assert.deepEqual(body.find((r) => r._id === Number(SID))._attachments, []);
  } finally {
    await s.close();
  }
});

const IMAGE_ANSWER_RECORDS = () =>
  records().map((r) =>
    r._id === Number(SID)
      ? { ...r, [FACILITY_XPATH]: "synthetic_facility_1.jpg", [ORGANISATION_XPATH]: "synthetic_org_2.jpg" }
      : r,
  );

test("H-1 and M-1 (constant false): blocked environments: /media 503 with no upstream request; /facilities lists no attachment", async () => {
  const blocked = [
    {},
    { VERCEL: "1" },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "prod" },
    { D31_LOCAL_PROVISIONAL: "true" },
    { ...LOCAL_ENV, VERCEL: "1" },
    { ...LOCAL_ENV, VERCEL_ENV: "production" },
    { ...LOCAL_ENV, VERCEL_ENV: "preview" },
    { ...LOCAL_ENV, NODE_ENV: "production" },
    ...DEPLOYMENT_INDICATORS.map((name) => ({ ...LOCAL_ENV, [name]: "1" })),
  ];
  for (const extra of blocked) {
    const label = JSON.stringify(extra);
    const s = await session({ env: { KOBO_TOKEN: TOKEN, API_KEY, ...extra }, recs: IMAGE_ANSWER_RECORDS(), policyOptions: { deletionPolicyApproved: false } });
    try {
      for (const path of [idsPath(SID, UID_1), idsPath(SID, "11", "large"), legacyPath(SID, UID_2, "medium")]) {
        assertNoStoreError(await s.request(path), 503);
      }
      assert.equal(s.stub.calls.length, 0, `no upstream request: ${label}`);
      assert.match(s.lines.join("\n"), /index_unavailable code=release_blocked/);

      const res = await s.request(`/facilities?key=${API_KEY}`);
      assert.equal(res.status, 200, label);
      const text = res.body.toString();
      for (const id of [UID_1, UID_2, UID_3, OTHER_UID, "synthetic_facility_1", "synthetic_org_2"]) {
        assert.ok(!text.includes(id), `${id} not listed: ${label}`);
      }
      const body = JSON.parse(text);
      for (const r of body) {
        if (Object.hasOwn(r, "_attachments")) assert.deepEqual(r._attachments, [], label);
      }
      // The /facilities read is not offered to the blocked index.
      assertNoStoreError(await s.request(idsPath(SID, UID_1)), 503);
      assert.equal(s.stub.imageCalls.length, 0);
    } finally {
      await s.close();
    }
  }
});

test("H-1: explicit local opt-in serves authorised photos", async () => {
  const s = await session();
  try {
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 200);
    assert.equal(s.stub.imageCalls.length, 1);
  } finally {
    await s.close();
  }
});

test("L-3: CORS preflight OPTIONS on /media is answered by CORS with no Kobo request", async () => {
  const s = await session();
  try {
    for (const path of [idsPath(SID, UID_1), legacyPath(SID, UID_1), "/media"]) {
      const allowed = await s.request(path, {
        method: "OPTIONS",
        headers: { Origin: ALLOWED_ORIGIN, "Access-Control-Request-Method": "GET" },
      });
      assert.equal(allowed.status, 204);
      assert.equal(allowed.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
      assert.equal(allowed.headers["access-control-allow-methods"], "GET");
      assert.equal(allowed.body.length, 0);

      const foreign = await s.request(path, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
      });
      assert.equal(foreign.status, 204);
      assert.notEqual(foreign.headers["access-control-allow-origin"], "https://evil.example");
      assert.equal(foreign.body.length, 0);
    }
    assert.equal(s.stub.calls.length, 0, "no data read and no image request");
    assert.equal(s.lines.length, 0);
  } finally {
    await s.close();
  }
});

test("L-4: /facilities does not send raw image-answer file names; other fields stay", async () => {
  const s = await session({ recs: IMAGE_ANSWER_RECORDS() });
  try {
    const res = await s.request(`/facilities?key=${API_KEY}`);
    assert.equal(res.status, 200);
    const text = res.body.toString();
    assert.doesNotMatch(text, /synthetic_facility_1|synthetic_org_2|\.jpg/);
    const rec = JSON.parse(text).find((r) => r._id === Number(SID));
    assert.equal(Object.hasOwn(rec, FACILITY_XPATH), false);
    assert.equal(Object.hasOwn(rec, ORGANISATION_XPATH), false);
    assert.equal(rec["fbo_details/name_of_facility"], "Synthetic Facility");
    assert.deepEqual(rec._attachments.map((a) => a.uid), [UID_1, UID_2, UID_3]);
  } finally {
    await s.close();
  }
});

test("L-5: /facilities API key: missing, empty, incorrect and correct configuration", async () => {
  const SECRET_KEY = "SENTINEL_API_KEY_93ab";
  const cases = [
    // [label, env API_KEY, query, status, Kobo read expected]
    ["missing API_KEY, no key", undefined, "", 503, false],
    ["missing API_KEY, any key", undefined, "?key=anything", 503, false],
    ["missing API_KEY, key=undefined text", undefined, "?key=undefined", 503, false],
    ["empty API_KEY, empty key", "", "?key=", 503, false],
    ["configured, no key", SECRET_KEY, "", 403, false],
    ["configured, empty key", SECRET_KEY, "?key=", 403, false],
    ["configured, wrong key", SECRET_KEY, "?key=wrong", 403, false],
    ["configured, repeated key", SECRET_KEY, `?key=${SECRET_KEY}&key=${SECRET_KEY}`, 403, false],
    ["configured, bracket key", SECRET_KEY, `?key[]=${SECRET_KEY}`, 403, false],
    ["configured, correct key", SECRET_KEY, `?key=${SECRET_KEY}`, 200, true],
  ];
  for (const [label, apiKey, query, status, reads] of cases) {
    const env = { KOBO_TOKEN: TOKEN, ...LOCAL_ENV };
    if (apiKey !== undefined) env.API_KEY = apiKey;
    const s = await session({ env });
    try {
      const res = await s.request(`/facilities${query}`);
      assert.equal(res.status, status, label);
      assert.equal(s.stub.dataCalls.length > 0, reads, label);
      if (status === 503) {
        assert.equal(res.headers["cache-control"], "no-store");
        assert.match(s.lines.join("\n"), /config_error code=missing_api_key/);
      }
      if (status === 200) assert.ok(Array.isArray(JSON.parse(res.body.toString())));
      for (const r of s.responses) {
        assert.ok(!r.body.includes(SECRET_KEY), label);
        assert.ok(!JSON.stringify(r.headers).includes(SECRET_KEY), label);
      }
      assert.ok(!s.lines.join("\n").includes(SECRET_KEY), label);
    } finally {
      await s.close();
    }
  }
});

test("D31-T22: DELETE, PUT, POST, PATCH give 405 on /media; no other API route exists", async () => {
  const s = await session();
  try {
    for (const method of ["DELETE", "PUT", "POST", "PATCH"]) {
      for (const path of [idsPath(SID, UID_1), legacyPath(SID, UID_1)]) {
        const res = await s.request(path, { method });
        assertNoStoreError(res, 405);
        assert.equal(res.headers.allow, "GET, HEAD");
      }
      for (const path of [`/facilities?key=${API_KEY}`, "/", "/media/x", "/attachments", "/delete", "/api/media"]) {
        assert.equal((await s.request(path, { method })).status, 404, `${method} ${path}`);
      }
    }
    assert.equal(s.stub.calls.length, 0);
  } finally {
    await s.close();
  }
});

test("D31-T23: legacy key is never compared, logged, returned or sent upstream", async () => {
  const responses = [];
  for (const apiKey of [LEGACY_KEY, API_KEY]) {
    const s = await session({ env: { ...ENV, API_KEY: apiKey } });
    try {
      const res = await s.request(legacyPath(SID, UID_1, "small", `&key=${LEGACY_KEY}`));
      assert.equal(res.status, 200, "same answer whatever API_KEY is: no comparison");
      assertNoStoreError(await s.request(`${idsPath(SID, UID_1)}&key=${LEGACY_KEY}`), 400);
      assertNoStoreError(await s.request(legacyPath(SID, "attNeverExisted000000001", "small", `&key=${LEGACY_KEY}`)), 404);
      for (const c of s.stub.calls) {
        assert.ok(!c.url.includes(LEGACY_KEY));
        assert.ok(!JSON.stringify(c.opts).includes(LEGACY_KEY));
      }
      assert.ok(!s.lines.join("\n").includes(LEGACY_KEY));
      responses.push(...s.responses);
    } finally {
      await s.close();
    }
  }
  assert.equal(responses.length, 6);
  for (const r of responses) {
    assert.ok(!r.body.includes(LEGACY_KEY));
    assert.ok(!JSON.stringify(r.headers).includes(LEGACY_KEY));
  }
});

test("D31-T16: the real guardedGet sends only GET to server-built Kobo URLs; no write method in api/", async () => {
  const { transport, requests } = recordingTransport((url) =>
    isDataPageUrl(url) ? jsonPage({ results: records(), next: null }) : ok(JPEG, "image/jpeg"),
  );
  const s = await session({ get: createGuardedGet({ transport }) });
  try {
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 200);
    assert.equal((await s.request(idsPath(SID, "12", "large"), { method: "HEAD" })).status, 200);
    assert.equal((await s.request(legacyPath(SID, UID_2, "medium"))).status, 200);
    assert.equal((await s.request(`/facilities?key=${API_KEY}`)).status, 200);
    for (const method of ["DELETE", "PUT", "POST", "PATCH"]) {
      assert.equal((await s.request(idsPath(SID, UID_1), { method })).status, 405);
    }
    assert.ok(requests.length >= 5);
    for (const r of requests) {
      assert.equal(r.method, "GET", r.url);
      assert.ok(r.url.startsWith(`${KOBO_ORIGIN}/api/v2/assets/${KOBO_ASSET_UID}/data/`));
    }
  } finally {
    await s.close();
  }
  const apiDir = fileURLToPath(new URL("../../api/", import.meta.url));
  const files = [join(apiDir, "index.js"), ...readdirSync(join(apiDir, "_lib")).map((f) => join(apiDir, "_lib", f))];
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /method:\s*["'](?!GET["'])/i, file);
    assert.doesNotMatch(src, /\bapp\.(delete|put|post|patch)\s*\(/i, file);
    assert.doesNotMatch(src, /\b(unlink|rmSync|rm|deleteAttachment|bulk_delete)\s*\(/, file);
  }
});

test("D31-T19: token, legacy key and attachment identifiers never in responses or logs", async () => {
  // Self-contained: success, misses, rejects, failures and /facilities.
  let fail = false;
  const s = await session({
    dataResponder: (url, opts, n, state) =>
      fail ? { status: 500, headers: {}, body: Buffer.alloc(0) } : jsonPage({ results: state.records, next: null }),
  });
  try {
    const expected = [
      [idsPath(SID, UID_1), 200],
      [legacyPath(SID, UID_2, "large", `&key=${LEGACY_KEY}`), 200],
      [idsPath(SID, MARKED), 404],
      [legacyPath(OTHER_SID, UID_1, "small", `&key=${LEGACY_KEY}`), 404],
      [`${idsPath(SID, UID_1)}&key=${LEGACY_KEY}`, 400],
      [`/media?url=${encodeURIComponent(`https://evil.example/${TOKEN}`)}&key=${LEGACY_KEY}`, 400],
      [`/facilities?key=${API_KEY}`, 200],
    ];
    for (const [path, status] of expected) assert.equal((await s.request(path)).status, status, path);
    fail = true;
    s.clock.advance(INDEX_MAX_AGE_MS + 1);
    assert.equal((await s.request(idsPath(SID, UID_1))).status, 503);
    assert.equal((await s.request(legacyPath(SID, UID_1, "small", `&key=${LEGACY_KEY}`))).status, 503);

    // Images carried the stub JPEG bytes; the token went only in the header.
    assert.ok(s.responses.filter((r) => r.status === 200 && r.body.equals(JPEG)).length === 2);
    for (const c of s.stub.calls) assert.equal(c.opts.headers.Authorization, `Token ${TOKEN}`);
    assert.ok(s.lines.length > 0, "the failures were logged");
    for (const r of s.responses) {
      assert.ok(!r.body.includes(TOKEN));
      assert.ok(!r.body.includes(LEGACY_KEY));
      assert.ok(!JSON.stringify(r.headers).includes(TOKEN));
    }
    for (const line of s.lines) {
      for (const secret of [TOKEN, LEGACY_KEY, API_KEY, SID, UID_1, UID_2, OTHER_UID, "kf.kobotoolbox.org"]) {
        assert.ok(!line.includes(secret), `log line contains ${secret}`);
      }
    }
  } finally {
    await s.close();
  }
});
