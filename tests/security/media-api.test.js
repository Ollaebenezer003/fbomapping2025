import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { KOBO_ASSET_UID } from "../../api/_lib/kobo.js";
import { MEDIA_MAX_BYTES } from "../../api/_lib/media.js";
import {
  API_KEY, FACILITY_XPATH, HTML, JPEG, LOCAL_ENV, PNG, SVG, TOKEN, WEBP, captureLog, fetchAll, koboStub, ok, startApp,
} from "./helpers.js";

const SID = "123456789";
const UID = "attWNZNwhXK6HDYVkZJSn9jy";
const CANONICAL_SMALL = `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/small/`;
const ENV = Object.freeze({ KOBO_TOKEN: TOKEN, API_KEY, ...LOCAL_ENV });

// Synthetic Kobo data for the D31 index: one authorised photo, addressed by
// uid or by numeric id 42.
const RECORDS = [
  { _id: Number(SID), _attachments: [{ uid: UID, id: 42, mimetype: "image/jpeg", question_xpath: FACILITY_XPATH }] },
];

// Every response and log line produced in this file is checked for the
// sentinel token inside `run`, so no test depends on another test.
function assertNoTokenLeak(res, lines) {
  assert.ok(!res.body.includes(TOKEN), "token in response body");
  assert.ok(!JSON.stringify(res.headers).includes(TOKEN), "token in response headers");
  for (const line of lines) {
    assert.ok(!line.includes(TOKEN), "token in logs");
    assert.ok(!line.includes("kf.kobotoolbox.org/api"), "attachment URL in logs");
  }
}

async function run({ responder = () => ok(JPEG, "image/jpeg"), env = ENV, path, method = "GET", headers = {} }) {
  const stub = koboStub({ records: RECORDS, imageResponder: responder });
  const { log, lines } = captureLog();
  const app = await startApp({ get: stub.get, env, log });
  try {
    const res = await fetchAll(await fetch(app.base + path, { method, headers, redirect: "manual" }));
    assertNoTokenLeak(res, lines);
    // `calls` are image requests only; the index data read is separate.
    return { res, calls: stub.imageCalls, dataCalls: stub.dataCalls, lines };
  } finally {
    await app.close();
  }
}

const idsPath = (sid = SID, aid = UID, size = "small") =>
  `/media?${new URLSearchParams({ sid, aid, size })}`;
const legacyPath = (raw, extra = "") => `/media?url=${encodeURIComponent(raw)}${extra}`;

function assertSafeErrorResponse(res, status) {
  assert.equal(res.status, status);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.headers["content-type"], /^application\/json/);
  const body = JSON.parse(res.body.toString());
  assert.deepEqual(Object.keys(body), ["error"]);
}

test("delivers JPEG, PNG and WebP with safe headers from a server-built URL", async () => {
  for (const [body, type, ext] of [
    [JPEG, "image/jpeg", "jpg"],
    [PNG, "image/png", "png"],
    [WEBP, "image/webp", "webp"],
    [JPEG, "image/jpg; charset=binary", "jpg"],
  ]) {
    const { res, calls } = await run({ responder: () => ok(body, type), path: idsPath() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, body);
    assert.equal(res.headers["content-type"], type.startsWith("image/jpg") ? "image/jpeg" : type);
    assert.equal(res.headers["content-length"], String(body.length));
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.equal(res.headers["content-disposition"], `inline; filename="photo.${ext}"`);
    assert.equal(res.headers["cache-control"], "private, max-age=300");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.equal(res.headers["set-cookie"], undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, CANONICAL_SMALL);
    assert.equal(calls[0].opts.headers.Authorization, `Token ${TOKEN}`);
    assert.equal(calls[0].opts.maxBytes, MEDIA_MAX_BYTES);
    assert.ok(calls[0].opts.timeoutMs > 0 && calls[0].opts.timeoutMs <= 10000);
  }
});

test("upstream response headers are not passed through", async () => {
  const { res } = await run({
    responder: () => ({
      status: 200,
      headers: { "content-type": "image/jpeg", "set-cookie": "a=b", "x-upstream": "1", "content-disposition": "attachment" },
      body: JPEG,
    }),
    path: idsPath(),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers["set-cookie"], undefined);
  assert.equal(res.headers["x-upstream"], undefined);
  assert.equal(res.headers["content-disposition"], 'inline; filename="photo.jpg"');
});

test("HEAD returns headers without a body", async () => {
  const { res } = await run({ path: idsPath(), method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 0);
  assert.equal(res.headers["content-type"], "image/jpeg");
});

test("all three sizes and numeric attachment ids map to canonical URLs", async () => {
  for (const size of ["small", "medium", "large"]) {
    const { calls } = await run({ path: idsPath(SID, "42", size) });
    assert.equal(calls[0].url, `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/42/${size}/`);
  }
});

test("canonical legacy url= requests are parsed and rebuilt (cached clients keep working)", async () => {
  for (const [raw, extra] of [
    [CANONICAL_SMALL, ""],
    [CANONICAL_SMALL, "&key=old-client-key"],
    [`${CANONICAL_SMALL}?format=json`, ""],
  ]) {
    const { res, calls } = await run({ path: legacyPath(raw, extra) });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, CANONICAL_SMALL);
  }
});

test("malicious or non-canonical legacy URLs are rejected without any upstream request", async () => {
  const PATH = `/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/small/`;
  for (const raw of [
    "https://attacker.example/x.jpg",
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:8080/admin",
    "http://[::1]/",
    `http://kf.kobotoolbox.org${PATH}`,
    `https://kf.kobotoolbox.org.evil.example${PATH}`,
    `https://kf.kobotoolbox.org@evil.example${PATH}`,
    `https://evil.example/#https://kf.kobotoolbox.org${PATH}`,
    `https://KF.KOBOTOOLBOX.ORG${PATH}`,
    `https://kf.kobotoolbox.org.${PATH}`,
    `https://kf.kobotoolbox.org:8443${PATH}`,
    `https://kf.kobotoolbox.org/token/`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json`,
    `https://kf.kobotoolbox.org/api/v2/assets/aOtherAsset1234567890/data/${SID}/attachments/${UID}/small/`,
    `${CANONICAL_SMALL}../../../../token/`,
    "javascript:alert(1)",
    "file:///etc/passwd",
    `${CANONICAL_SMALL}?format=json${"a".repeat(2100)}`,
  ]) {
    const { res, calls, dataCalls } = await run({ path: legacyPath(raw) });
    assertSafeErrorResponse(res, 400);
    assert.equal(calls.length + dataCalls.length, 0, raw.slice(0, 100));
  }
});

test("invalid identifiers are rejected without any upstream request", async () => {
  for (const path of [
    idsPath("abc"),
    idsPath("1/2"),
    idsPath("-1"),
    idsPath(""),
    idsPath("1234567890123"),
    idsPath(SID, "../../token"),
    idsPath(SID, "att"),
    idsPath(SID, "%2e%2e"),
    idsPath(SID, "att<script>alert1x"),
    idsPath(SID, UID, "original"),
    idsPath(SID, UID, "SMALL"),
    `/media?sid=${SID}&aid=${UID}`, // missing size
    `/media?sid=${SID}&sid=1&aid=${UID}&size=small`, // repeated parameter
    `/media?sid=${SID}&aid=${UID}&aid=42&size=small`,
    `/media?sid=${SID}&aid=${UID}&size=small&url=${encodeURIComponent(CANONICAL_SMALL)}`, // ambiguous
    `/media?url=${encodeURIComponent(CANONICAL_SMALL)}&url=${encodeURIComponent(CANONICAL_SMALL)}`,
    "/media",
    "/media?key=anything",
  ]) {
    const { res, calls, dataCalls } = await run({ path });
    assertSafeErrorResponse(res, 400);
    assert.equal(calls.length + dataCalls.length, 0, path);
  }
});

test("non-GET methods are rejected", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const { res, calls, dataCalls } = await run({ path: idsPath(), method });
    assertSafeErrorResponse(res, 405);
    assert.equal(res.headers.allow, "GET, HEAD");
    assert.equal(calls.length, 0);
    assert.equal(dataCalls.length, 0);
  }
});

test("foreign Origin headers are rejected (existing behaviour preserved)", async () => {
  const { res, calls } = await run({ path: idsPath(), headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("every upstream redirect is rejected; only the redirect host is logged", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const { res, calls, lines } = await run({
      responder: () => ({
        status,
        headers: { location: "https://evil.example/steal?sig=SECRETSIG123&x=1" },
        body: Buffer.alloc(0),
      }),
      path: idsPath(),
    });
    assertSafeErrorResponse(res, 502);
    assert.equal(calls.length, 1);
    const logText = lines.join("\n");
    assert.match(logText, /upstream_redirect_rejected status=\d+ host=evil\.example/);
    assert.doesNotMatch(logText, /SECRETSIG123|steal/);
  }
});

test("upstream status codes map to generic errors", async () => {
  const cases = [
    [404, 404, null],
    [410, 404, null], // D31 OD-8
    [401, 502, /kobo_auth_failure status=401/],
    [403, 502, /kobo_auth_failure status=403/],
    [500, 502, /upstream_status status=500/],
    [204, 502, /upstream_status status=204/],
  ];
  for (const [upstream, expected, logPattern] of cases) {
    const { res, lines } = await run({
      responder: () => ({ status: upstream, headers: { "content-type": "text/html" }, body: HTML }),
      path: idsPath(),
    });
    assertSafeErrorResponse(res, expected);
    assert.ok(!res.body.includes("<script>"));
    if (logPattern) assert.match(lines.join("\n"), logPattern);
  }
});

test("HTML, SVG, mismatched, empty and oversized content is rejected", async () => {
  const oversized = Buffer.concat([JPEG, Buffer.alloc(MEDIA_MAX_BYTES)]);
  for (const [body, type] of [
    [HTML, "text/html"],
    [HTML, "image/jpeg"], // declared image, actually HTML
    [SVG, "image/svg+xml"],
    [SVG, "image/png"],
    [JPEG, "image/png"], // signature mismatch
    [PNG, "image/webp"],
    [JPEG, "application/octet-stream"],
    [JPEG, undefined],
    [JPEG, "text/html"],
    [Buffer.alloc(0), "image/jpeg"],
    [oversized, "image/jpeg"],
    [Buffer.from([0xff, 0xd8]), "image/jpeg"], // truncated signature
  ]) {
    const { res, lines } = await run({
      responder: () => ({ status: 200, headers: type ? { "content-type": type } : {}, body }),
      path: idsPath(),
    });
    assertSafeErrorResponse(res, 502);
    assert.ok(!res.body.includes("<script>"));
    assert.ok(!res.body.includes("<svg"));
    assert.match(lines.join("\n"), /content_rejected/);
  }
});

test("transport failures map to generic 502/504 responses", async () => {
  for (const [code, expected] of [
    ["TIMEOUT", 504],
    ["TOO_LARGE", 502],
    ["ABORTED", 502],
    ["BLOCKED_ADDRESS", 502],
    ["NETWORK", 502],
    ["DECODE", 502],
  ]) {
    const { res, lines } = await run({
      responder: () => {
        throw Object.assign(new Error(`connect failed with ${TOKEN}`), { code });
      },
      path: idsPath(),
    });
    assertSafeErrorResponse(res, expected);
    assert.match(lines.join("\n"), new RegExp(`upstream_error code=${code}`));
  }
});

test("untrusted error codes are not written to logs", async () => {
  const { lines } = await run({
    responder: () => {
      throw Object.assign(new Error("x"), { code: `EVIL ${TOKEN}\nforged-line` });
    },
    path: idsPath(),
  });
  assert.match(lines.join("\n"), /upstream_error code=unknown/);
});

test("kill switch disables the proxy without contacting Kobo", async () => {
  for (const value of ["false", "FALSE", "0", "off", "no", " false "]) {
    const { res, calls, dataCalls } = await run({ env: { ...ENV, MEDIA_PROXY_ENABLED: value }, path: idsPath() });
    assertSafeErrorResponse(res, 503);
    assert.equal(calls.length, 0);
    assert.equal(dataCalls.length, 0);
  }
  for (const value of ["true", "1", ""]) {
    const { res } = await run({ env: { ...ENV, MEDIA_PROXY_ENABLED: value }, path: idsPath() });
    assert.equal(res.status, 200);
  }
});

test("missing Kobo token fails closed without contacting Kobo", async () => {
  const { res, calls, dataCalls, lines } = await run({ env: { API_KEY, ...LOCAL_ENV }, path: idsPath() });
  assertSafeErrorResponse(res, 503);
  assert.equal(calls.length, 0);
  assert.equal(dataCalls.length, 0);
  assert.match(lines.join("\n"), /missing_token/);
});

test("the Kobo token never appears in any response or log line", async () => {
  // Self-contained: success, rejects, upstream failures and a logged error.
  const results = [
    await run({ path: idsPath() }),
    await run({ path: legacyPath(`https://kf.kobotoolbox.org/${TOKEN}`) }),
    await run({ path: idsPath(), responder: () => ({ status: 401, headers: {}, body: Buffer.from(TOKEN) }) }),
    await run({
      path: idsPath(),
      responder: () => {
        throw Object.assign(new Error(`failed with ${TOKEN}`), { code: "ECONNRESET" });
      },
    }),
    await run({ path: idsPath(), responder: () => ok(Buffer.from(`<html>${TOKEN}</html>`), "image/jpeg") }),
  ];
  assert.deepEqual(results.map((r) => r.res.status), [200, 400, 502, 502, 502]);
  assert.ok(results.some((r) => r.lines.length > 0), "failures were logged");
  for (const { res, lines } of results) assertNoTokenLeak(res, lines);
});
