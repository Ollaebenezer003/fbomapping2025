import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  KOBO_ASSET_UID,
  KOBO_DATA_URL,
  KOBO_PAGE_SIZE,
  MAX_KOBO_PAGES,
  fetchAllKoboData,
} from "../../api/_lib/kobo.js";
import { mapRecordChoices } from "../../api/_lib/choiceMapper.js";
import { API_KEY, TOKEN, captureLog, fakeGet, fetchAll, startApp } from "./helpers.js";

const BASE = `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/`;
const ENV = Object.freeze({ KOBO_TOKEN: TOKEN, API_KEY });
const jsonPage = (obj) => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(obj)) });

// Synthetic records only (no production data).
const R1 = {
  _id: 1001,
  "state_and_lga/state": "Akwa_Ibom",
  "state_and_lga/lga": "Uyo",
  "category_of_fbo/fbo_category": "Non_Facility",
  "category_of_fbo/fbo_block": "Christian",
  "facility_service_delivery/facility_funding_source": "Grants Cash_Donations",
  "collect_gps/final_geopoint": "5.03 7.92 60 5",
  _geolocation: [5.03, 7.92],
  _attachments: [{ uid: "attAAAAAAAAAAAAAAAAAAAAA", mimetype: "image/jpeg" }],
};
const R2 = { _id: 1002, "state_and_lga/state": "FCT", "category_of_fbo/fbo_category": "Facility", _attachments: [] };
const R3 = { _id: 1003, "state_and_lga/state": "Lagos", "fbo_details/name_of_facility": "Test_Facility One" };

async function run(responder, { env = ENV, path = `/facilities?key=${API_KEY}`, headers = {} } = {}) {
  const { get, calls } = fakeGet(responder);
  const { log, lines } = captureLog();
  const app = await startApp({ get, env, log });
  try {
    const res = await fetchAll(await fetch(app.base + path, { headers }));
    for (const line of lines) assert.ok(!line.includes(TOKEN), "token in logs");
    assert.ok(!res.body.includes(TOKEN), "token in response");
    return { res, calls, lines };
  } finally {
    await app.close();
  }
}

// Kobo-style `next` link: same URL with `limit` and `start` replaced
// (DRF replace_query_param emits sorted keys).
const koboNext = (limit, start) => `${BASE}?format=json&limit=${limit}&start=${start}`;
const syntheticRecords = (from, count) =>
  Array.from({ length: count }, (_, i) => ({
    _id: from + i,
    "state_and_lga/state": "Lagos",
    "category_of_fbo/fbo_category": i % 2 ? "Facility" : "Non_Facility",
  }));

test("initial Kobo request asks for 1,000 records per page", async () => {
  assert.equal(KOBO_PAGE_SIZE, 1000);
  const { calls } = await run(() => jsonPage({ results: [], next: null }));
  assert.equal(calls.length, 1);
  const first = new URL(calls[0].url);
  assert.equal(`${first.origin}${first.pathname}`, BASE);
  assert.equal(first.searchParams.get("format"), "json");
  assert.equal(first.searchParams.get("limit"), "1000");
  assert.equal(first.searchParams.has("start"), false);
  assert.deepEqual([...first.searchParams.keys()], ["format", "limit"]);
});

test("pages are combined in order with no omitted or duplicated records", async () => {
  const pages = new Map([
    [KOBO_DATA_URL, { results: syntheticRecords(1, 1000), next: koboNext(1000, 1000) }],
    [koboNext(1000, 1000), { results: syntheticRecords(1001, 1000), next: koboNext(1000, 2000) }],
    [koboNext(1000, 2000), { results: syntheticRecords(2001, 500), next: null }],
  ]);
  const { res, calls } = await run((url) => jsonPage(pages.get(url) ?? { results: [], next: null }));
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c.url), [...pages.keys()]);
  const body = JSON.parse(res.body.toString());
  assert.equal(body.length, 2500);
  assert.deepEqual(body.map((r) => r._id), Array.from({ length: 2500 }, (_, i) => i + 1));
  const all = [...pages.values()].flatMap((p) => p.results);
  assert.deepEqual(body, JSON.parse(JSON.stringify(all.map(mapRecordChoices))));
});

test("a server-clamped page size (Kobo returning smaller pages) is still followed", async () => {
  const pages = new Map([
    [KOBO_DATA_URL, { results: syntheticRecords(1, 100), next: koboNext(100, 100) }],
    [koboNext(100, 100), { results: syntheticRecords(101, 40), next: null }],
  ]);
  const { res } = await run((url) => jsonPage(pages.get(url) ?? { results: [], next: null }));
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body.toString()).map((r) => r._id), Array.from({ length: 140 }, (_, i) => i + 1));
});

test("page cap is enforced by fetchAllKoboData (direct, bounded)", { timeout: 10000 }, async () => {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (calls.length > 10) return jsonPage({ results: [], next: null }); // bound if the cap regresses
    return jsonPage({ results: syntheticRecords(calls.length, 1), next: koboNext(1, calls.length) });
  };
  await assert.rejects(fetchAllKoboData({ get, token: TOKEN, maxPages: 3 }), (err) => err.code === "page_limit");
  assert.equal(calls.length, 3);
});

test("multi-page output is identical to the previous ETL (concatenate, then map choices)", async () => {
  const next = `${BASE}?format=json&limit=2&start=2`;
  const { res, calls } = await run((url) =>
    url === KOBO_DATA_URL ? jsonPage({ results: [R1, R2], next }) : jsonPage({ results: [R3], next: null }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=0, s-maxage=300, stale-while-revalidate=300");
  const expected = JSON.parse(JSON.stringify([R1, R2, R3].map(mapRecordChoices)));
  assert.deepEqual(JSON.parse(res.body.toString()), expected);
  assert.deepEqual(calls.map((c) => c.url), [KOBO_DATA_URL, next]);
  for (const c of calls) assert.equal(c.opts.headers.Authorization, `Token ${TOKEN}`);
});

test("single-page `data` shape and empty responses are preserved", async () => {
  let r = await run(() => jsonPage({ data: [R3] }));
  assert.deepEqual(JSON.parse(r.res.body.toString()), JSON.parse(JSON.stringify([mapRecordChoices(R3)])));
  r = await run(() => jsonPage({ unexpected: true }));
  assert.deepEqual(JSON.parse(r.res.body.toString()), []);
});

test("untrusted pagination links are never requested with the token", async () => {
  for (const next of [
    `https://evil.example/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json&start=2`,
    `http://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json&start=2`,
    `https://kf.kobotoolbox.org.evil.example/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json`,
    `https://kf.kobotoolbox.org/api/v2/assets/aOtherAsset1234567890/data/?format=json&start=2`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/?format=json`,
    `https://kf.kobotoolbox.org/token/?format=json`,
    `${BASE}?format=json&start=2&fields=["_id"]`,
    `${BASE}?format=json&start=2&start=3`,
    `${BASE}?format=xml&start=2`,
    `https://u:p@kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json`,
    `${BASE}?format=json&start=2#x`,
    "/relative/path",
    42,
    // Otherwise valid Kobo links carrying unexpected (numeric) parameters.
    `${koboNext(1000, 1000)}&offset=5`,
    `${koboNext(1000, 1000)}&page=2`,
    `${koboNext(1000, 1000)}&page_size=2`,
    `${koboNext(1000, 1000)}&cursor=1`,
    `${koboNext(1000, 1000)}&query=1`,
    `${koboNext(1000, 1000)}&sort=1`,
    `${BASE}?format=json&offset=5`,
    `${BASE}?format=json&page=2`,
  ]) {
    const { res, calls, lines } = await run((url) =>
      url === KOBO_DATA_URL ? jsonPage({ results: [R1], next }) : jsonPage({ results: [], next: null }),
    );
    assert.equal(res.status, 500, String(next));
    assert.deepEqual(JSON.parse(res.body.toString()), { error: "Failed to fetch data from Kobo" });
    assert.equal(calls.length, 1, String(next));
    assert.match(lines.join("\n"), /kobo_fetch_failed code=untrusted_page_url/);
  }
});

// The fake Kobo below ends pagination itself once well past the cap, so a
// regression in loop detection or the page cap produces a clear assertion
// failure instead of an unbounded loop. Per-test timeouts add a second bound.
const RUNAWAY_BOUND = MAX_KOBO_PAGES + 5;

test("pagination loops are detected", { timeout: 15000 }, async () => {
  // Self-loop
  let r = await run((url, opts, n) =>
    jsonPage({ results: [R1], next: n >= RUNAWAY_BOUND ? null : KOBO_DATA_URL }),
  );
  assert.equal(r.res.status, 500);
  assert.equal(r.calls.length, 1);
  assert.match(r.lines.join("\n"), /pagination_loop/);
  // A -> B -> A
  const b = koboNext(1, 1);
  r = await run((url, opts, n) =>
    jsonPage({ results: [R1], next: n >= RUNAWAY_BOUND ? null : url === KOBO_DATA_URL ? b : KOBO_DATA_URL }),
  );
  assert.equal(r.res.status, 500);
  assert.equal(r.calls.length, 2);
  assert.match(r.lines.join("\n"), /pagination_loop/);
});

test("excessive page counts are stopped", { timeout: 15000 }, async () => {
  const { res, calls, lines } = await run((url, opts, n) =>
    jsonPage({ results: [R1], next: n >= RUNAWAY_BOUND ? null : koboNext(1, n) }),
  );
  assert.equal(res.status, 500);
  assert.equal(calls.length, MAX_KOBO_PAGES);
  assert.match(lines.join("\n"), /page_limit/);
});

test("redirects, error statuses and malformed JSON fail closed", async () => {
  for (const responder of [
    () => ({ status: 302, headers: { location: "https://evil.example/" }, body: Buffer.alloc(0) }),
    () => ({ status: 401, headers: {}, body: Buffer.alloc(0) }),
    () => ({ status: 500, headers: {}, body: Buffer.from("oops") }),
    () => ({ status: 200, headers: {}, body: Buffer.from("<html>not json</html>") }),
  ]) {
    const { res, calls } = await run(responder);
    assert.equal(res.status, 500);
    assert.equal(calls.length, 1);
  }
});

test("transport errors are logged by code only", async () => {
  const { res, lines } = await run(() => {
    throw Object.assign(new Error(`timeout contacting ${TOKEN}`), { code: "TIMEOUT" });
  });
  assert.equal(res.status, 500);
  assert.match(lines.join("\n"), /kobo_fetch_failed code=TIMEOUT/);
});

test("existing key and origin checks are preserved and short-circuit before Kobo", async () => {
  let r = await run(() => jsonPage({ results: [] }), { path: "/facilities?key=wrong" });
  assert.equal(r.res.status, 403);
  assert.equal(r.calls.length, 0);
  r = await run(() => jsonPage({ results: [] }), { headers: { Origin: "https://evil.example" } });
  assert.equal(r.res.status, 403);
  assert.equal(r.calls.length, 0);
});

test("missing Kobo token fails closed without an upstream request", async () => {
  const { res, calls } = await run(() => jsonPage({ results: [] }), { env: { API_KEY } });
  assert.equal(res.status, 500);
  assert.equal(calls.length, 0);
});
