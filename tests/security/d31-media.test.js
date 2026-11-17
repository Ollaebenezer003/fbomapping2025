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
import {
  API_KEY, FACILITY_XPATH, JPEG, ORGANISATION_XPATH, TOKEN,
  captureLog, fakeClock, fetchAll, jsonPage, koboStub, ok, photo, startApp,
} from "./helpers.js";

const ENV = Object.freeze({ KOBO_TOKEN: TOKEN, API_KEY });
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

const observed = { responses: [], logs: [], upstream: [] };

/** One app with a manual clock; several requests share its index. */
async function session({ env = ENV, recs = records(), dataResponder, imageResponder, policyOptions } = {}) {
  const clock = fakeClock();
  const stub = koboStub({ records: recs, dataResponder, imageResponder });
  const { log, lines } = captureLog();
  const app = await startApp({
    get: stub.get, env, log, now: clock.now, indexOptions: { setTimer: clock.setTimer }, policyOptions,
  });
  const request = async (path, init = {}) => {
    const res = await fetchAll(await fetch(app.base + path, { redirect: "manual", ...init }));
    observed.responses.push(res);
    return res;
  };
  return {
    clock, stub, lines, request,
    async close() {
      observed.logs.push(...lines);
      observed.upstream.push(...stub.calls);
      await app.close();
    },
  };
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
    for (const res of observed.responses.slice(-6)) {
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

test("D31-T15: kill switch and missing token: no index build and no Kobo request", async () => {
  for (const env of [{ ...ENV, MEDIA_PROXY_ENABLED: "false" }, { API_KEY }]) {
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

test("provisional deletion rule: Production environment serves no photo and lists no attachment", async () => {
  const s = await session({ env: { ...ENV, VERCEL_ENV: "production" } });
  try {
    assertNoStoreError(await s.request(idsPath(SID, UID_1)), 503);
    assert.equal(s.stub.calls.length, 0);
    assert.match(s.lines.join("\n"), /index_unavailable code=release_blocked/);
    const body = JSON.parse((await s.request(`/facilities?key=${API_KEY}`)).body.toString());
    for (const r of body) if (r._attachments) assert.deepEqual(r._attachments, []);
  } finally {
    await s.close();
  }
  const preview = await session({ env: { ...ENV, VERCEL_ENV: "preview" } });
  try {
    assert.equal((await preview.request(idsPath(SID, UID_1))).status, 200);
  } finally {
    await preview.close();
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
    } finally {
      await s.close();
    }
  }
  for (const r of observed.responses) {
    assert.ok(!r.body.includes(LEGACY_KEY));
    assert.ok(!JSON.stringify(r.headers).includes(LEGACY_KEY));
  }
});

test("D31-T16: every upstream call is a GET to a server-built Kobo URL; no write method in api/", () => {
  for (const c of observed.upstream) {
    assert.equal(c.opts.method, undefined, "the stub get is GET-only; no method override");
    assert.ok(c.url.startsWith(`${KOBO_ORIGIN}/api/v2/assets/${KOBO_ASSET_UID}/data/`));
  }
  const apiDir = fileURLToPath(new URL("../../api/", import.meta.url));
  const files = [join(apiDir, "index.js"), ...readdirSync(join(apiDir, "_lib")).map((f) => join(apiDir, "_lib", f))];
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /method:\s*["'](?!GET["'])/i, file);
    assert.doesNotMatch(src, /\bapp\.(delete|put|post|patch)\s*\(/i, file);
    assert.doesNotMatch(src, /\b(unlink|rmSync|rm|deleteAttachment|bulk_delete)\s*\(/, file);
  }
  const safeHttp = readFileSync(join(apiDir, "_lib", "safeHttp.js"), "utf8");
  assert.match(safeHttp, /method:\s*"GET"/);
});

// Runs last: D31-T19.
test("D31-T19: token, legacy key and attachment identifiers never in responses or logs", () => {
  assert.ok(observed.responses.length > 100);
  for (const r of observed.responses) {
    assert.ok(!r.body.includes(TOKEN));
    assert.ok(!JSON.stringify(r.headers).includes(TOKEN));
  }
  for (const line of observed.logs) {
    for (const secret of [TOKEN, LEGACY_KEY, SID, UID_1, UID_2, OTHER_UID, "kf.kobotoolbox.org"]) {
      assert.ok(!line.includes(secret), `log line contains ${secret}`);
    }
  }
  // Images carried JPEG bytes only from the stub.
  assert.ok(observed.responses.some((r) => r.status === 200 && r.body.equals(JPEG)));
  assert.ok(ok);
});
