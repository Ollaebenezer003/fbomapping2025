import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createGuardedGet, createGuardedLookup, guardedGet, isPublicAddress } from "../../api/_lib/safeHttp.js";

// Local test server (127.0.0.1 only). Route behaviour is selected by path.
let server;
let port;
let hits = [];

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url);
    const big = Buffer.alloc(64 * 1024, 0x41);
    switch (req.url) {
      case "/ok":
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
      case "/redirect":
        res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` });
        return res.end();
      case "/declared-too-large":
        res.writeHead(200, { "content-length": String(10 * 1024 * 1024) });
        return res.end();
      case "/streamed-too-large": {
        res.writeHead(200, { "content-type": "image/jpeg" }); // chunked, no length
        let sent = 0;
        const pump = () => {
          while (sent < 2 * 1024 * 1024) {
            sent += big.length;
            if (!res.write(big)) return res.once("drain", pump);
          }
          res.end();
        };
        return pump();
      }
      case "/gzip-ok":
        res.writeHead(200, { "content-encoding": "gzip" });
        return res.end(zlib.gzipSync(Buffer.from("hello")));
      case "/gzip-bomb":
        res.writeHead(200, { "content-encoding": "gzip" });
        return res.end(zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 0)));
      case "/gzip-corrupt":
        res.writeHead(200, { "content-encoding": "gzip" });
        return res.end(Buffer.from("not gzip at all"));
      case "/encoding-unsupported":
        res.writeHead(200, { "content-encoding": "compress" });
        return res.end("x");
      case "/slow-headers":
        return setTimeout(() => {
          if (!res.writableEnded) res.end("late");
        }, 1500);
      case "/slow-body":
        res.writeHead(200, { "content-type": "image/jpeg" });
        res.write(Buffer.from([0xff, 0xd8]));
        return setTimeout(() => {
          if (!res.writableEnded) res.end();
        }, 1500);
      case "/aborted":
        res.writeHead(200, { "content-length": "1000" });
        res.write(Buffer.alloc(10));
        return setTimeout(() => req.socket.destroy(), 20);
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// Deterministic resolver for the allowed-path tests: kobo.test -> 127.0.0.1.
const loopbackLookup = (hostname, options, cb) => {
  if (hostname !== "kobo.test") return cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
  return cb(null, [{ address: "127.0.0.1", family: 4 }]);
};
const allowLoopbackOnly = (a) => a === "127.0.0.1";
const harnessGet = () => createGuardedGet({ transport: http, isAllowed: allowLoopbackOnly, lookup: loopbackLookup });
const url = (path) => `http://kobo.test:${port}${path}`;

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

test("default policy blocks loopback reached through DNS (localhost)", async () => {
  hits = [];
  const get = createGuardedGet({ transport: http });
  await rejectsWith(get(`http://localhost:${port}/ok`), "BLOCKED_ADDRESS");
  assert.deepEqual(hits, []);
});

test("default policy blocks private, metadata and mapped IP literals before connecting", async () => {
  hits = [];
  const get = createGuardedGet({ transport: http });
  for (const host of [
    "127.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254", "10.0.0.1", "0.0.0.0",
    "[fd00::1]", "[fe80::1]",
  ]) {
    await rejectsWith(get(`http://${host}:${port}/ok`, { timeoutMs: 2000 }), "BLOCKED_ADDRESS");
  }
  assert.deepEqual(hits, []);
});

// Unit level: the guarded lookup itself (no sockets, no network). A stand-in
// "public" address from TEST-NET-3 is marked allowed by the injected policy.
test("guarded DNS lookup rejects any answer containing a non-public address", async () => {
  const STAND_IN_PUBLIC = "203.0.113.10";
  const policy = (a) => a === STAND_IN_PUBLIC || isPublicAddress(a);
  const resolve = (answer, options) =>
    new Promise((done) => {
      const lookup = createGuardedLookup({ isAllowed: policy, lookup: (h, o, cb) => cb(null, answer) });
      lookup("kobo.test", options, (err, address, family) => done({ err, address, family }));
    });
  const pub = { address: STAND_IN_PUBLIC, family: 4 };
  for (const answer of [
    [pub, { address: "127.0.0.1", family: 4 }],
    [pub, { address: "169.254.169.254", family: 4 }],
    [pub, { address: "::ffff:10.0.0.1", family: 6 }],
    [pub, { address: "fd00::1", family: 6 }],
    [{ address: "10.0.0.5", family: 4 }, pub],
    [],
  ]) {
    for (const options of [{}, { all: true }, 4]) {
      const r = await resolve(answer, options);
      assert.equal(r.err?.code, "BLOCKED_ADDRESS", JSON.stringify(answer));
    }
  }
  // Allowed answers are returned in the shape Node expects.
  assert.deepEqual(await resolve([pub], {}), { err: null, address: STAND_IN_PUBLIC, family: 4 });
  const all = await resolve([pub], { all: true });
  assert.deepEqual(all.address, [pub]);
  // Resolver errors are passed through unchanged.
  const failing = createGuardedLookup({ lookup: (h, o, cb) => cb(Object.assign(new Error("x"), { code: "ENOTFOUND" })) });
  const errResult = await new Promise((done) => failing("kobo.test", {}, (err) => done(err)));
  assert.equal(errResult.code, "ENOTFOUND");
});

// Integration level. Every answer starts with 127.0.0.1, so even if a guard
// regressed, connections could only reach the local test server.
test("DNS answers containing any non-public address are rejected (rebinding and mixed answers)", { timeout: 15000 }, async () => {
  hits = [];
  const answers = [
    [{ address: "127.0.0.1", family: 4 }, { address: "169.254.169.254", family: 4 }],
    [{ address: "127.0.0.1", family: 4 }, { address: "::ffff:10.0.0.1", family: 6 }],
    [{ address: "127.0.0.1", family: 4 }, { address: "fd00::1", family: 6 }],
    [],
  ];
  for (const answer of answers) {
    const get = createGuardedGet({ transport: http, lookup: (h, o, cb) => cb(null, answer) });
    await rejectsWith(get(`http://rebind.test:${port}/ok`, { timeoutMs: 2000 }), "BLOCKED_ADDRESS");
  }
  // A resolver whose answer changes between queries is checked on the exact
  // answer used for the connection.
  let n = 0;
  const flipping = (h, o, cb) => cb(null, [{ address: n++ === 0 ? "127.0.0.1" : "203.0.113.10", family: 4 }]);
  await rejectsWith(
    createGuardedGet({ transport: http, lookup: flipping })(`http://flip.test:${port}/ok`, { timeoutMs: 2000 }),
    "BLOCKED_ADDRESS",
  );
  assert.deepEqual(hits, []);
});

test("post-connect peer check rejects independently of the DNS check; no credentials reach the server", { timeout: 15000 }, async () => {
  const SENTINEL = "PEER_CHECK_SENTINEL_TOKEN";
  for (const [transport, scheme] of [[http, "http"], [https, "https"]]) {
    // Raw TCP listener records every byte received from the client and never
    // responds. Sockets are tracked so cleanup is immediate even on failure.
    const received = [];
    const sockets = new Set();
    const raw = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("data", (d) => received.push(d));
      socket.on("error", () => {});
    });
    await new Promise((resolve) => raw.listen(0, "127.0.0.1", resolve));

    // Policy allows the DNS-stage check (first call) and denies the
    // post-connect peer check (second call) for the same address.
    const decisions = [];
    const policy = (address) => {
      const allow = decisions.length === 0 && address === "127.0.0.1";
      decisions.push([address, allow]);
      return allow;
    };
    const get = createGuardedGet({ transport, isAllowed: policy, lookup: loopbackLookup });
    let outcome;
    try {
      outcome = await get(`${scheme}://kobo.test:${raw.address().port}/`, {
        headers: { Authorization: `Token ${SENTINEL}` },
        timeoutMs: 1500,
      }).then(
        () => "resolved",
        (err) => err.code,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => raw.close(resolve));
    }

    assert.equal(outcome, "BLOCKED_ADDRESS", scheme);
    assert.deepEqual(decisions, [["127.0.0.1", true], ["127.0.0.1", false]], scheme);
    const bytes = Buffer.concat(received);
    assert.ok(!bytes.includes(SENTINEL), `${scheme}: credential reached the server`);
    assert.ok(!bytes.includes("Authorization"), `${scheme}: HTTP headers reached the server`);
    if (scheme === "http") assert.equal(bytes.length, 0, "http: request bytes reached the server");
  }
});

test("DNS failures surface as a generic network error", async () => {
  const get = createGuardedGet({ transport: http, lookup: loopbackLookup, isAllowed: allowLoopbackOnly });
  await rejectsWith(get(`http://unknown.test:${port}/ok`), "NETWORK");
});

test("production client refuses non-HTTPS URLs", async () => {
  await assert.rejects(guardedGet(`http://kobo.test:${port}/ok`), (err) => err.code === "NETWORK");
});

test("successful response returns status and body", async () => {
  const r = await harnessGet()(url("/ok"));
  assert.equal(r.status, 200);
  assert.deepEqual([...r.body], [0xff, 0xd8, 0xff, 0x00]);
});

test("redirects are returned, never followed", async () => {
  hits = [];
  const r = await harnessGet()(url("/redirect"));
  assert.equal(r.status, 302);
  assert.equal(r.body.length, 0);
  assert.deepEqual(hits, ["/redirect"]);
});

test("declared Content-Length above the cap is rejected before reading", async () => {
  await rejectsWith(harnessGet()(url("/declared-too-large"), { maxBytes: 1024 * 1024 }), "TOO_LARGE");
});

test("streamed body above the cap is rejected", async () => {
  await rejectsWith(harnessGet()(url("/streamed-too-large"), { maxBytes: 1024 * 1024 }), "TOO_LARGE");
});

test("decoded size is capped (compression bomb)", async () => {
  await rejectsWith(harnessGet()(url("/gzip-bomb"), { maxBytes: 1024 * 1024 }), "TOO_LARGE");
});

test("valid compressed bodies are decoded", async () => {
  const r = await harnessGet()(url("/gzip-ok"));
  assert.equal(r.body.toString(), "hello");
});

test("corrupt or unsupported encodings are rejected", async () => {
  await rejectsWith(harnessGet()(url("/gzip-corrupt")), "DECODE");
  await rejectsWith(harnessGet()(url("/encoding-unsupported")), "UNSUPPORTED_ENCODING");
});

test("slow headers and stalled bodies time out", async () => {
  await rejectsWith(harnessGet()(url("/slow-headers"), { timeoutMs: 200 }), "TIMEOUT");
  await rejectsWith(harnessGet()(url("/slow-body"), { timeoutMs: 200 }), "TIMEOUT");
});

test("aborted upstream streams are rejected", async () => {
  await rejectsWith(harnessGet()(url("/aborted")), "ABORTED");
});

test("proxy environment variables are ignored", async () => {
  const saved = {};
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "NO_PROXY"]) {
    saved[k] = process.env[k];
  }
  process.env.HTTP_PROXY = "http://127.0.0.1:9";
  process.env.HTTPS_PROXY = "http://127.0.0.1:9";
  process.env.ALL_PROXY = "http://127.0.0.1:9";
  process.env.http_proxy = "http://127.0.0.1:9";
  process.env.https_proxy = "http://127.0.0.1:9";
  delete process.env.NO_PROXY;
  try {
    hits = [];
    const r = await harnessGet()(url("/ok"));
    assert.equal(r.status, 200);
    assert.deepEqual(hits, ["/ok"]);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
