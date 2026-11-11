// TLS certificate and hostname verification for the outbound Kobo client.
// A throwaway CA and server certificate (SAN kobo.test) are generated with
// OpenSSL in a temporary directory for each run; nothing is committed. The
// client runs in a child process so trust-store and TLS environment
// variables behave as they would at runtime. No external network access.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLIENT = fileURLToPath(new URL("./fixtures/tls-client.js", import.meta.url));

function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const SKIP = hasOpenssl() ? false : "openssl is not available to generate test certificates";

let dir;
let server;
let port;
let requests = [];

before(async () => {
  if (SKIP) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fbo-tls-test-"));
  const openssl = (args) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
    "-days", "1", "-subj", "/CN=FBO Mapping Test CA"]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "srv.key", "-out", "srv.csr",
    "-subj", "/CN=kobo.test"]);
  fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=DNS:kobo.test\n");
  openssl(["x509", "-req", "-in", "srv.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
    "-out", "srv.pem", "-days", "1", "-extfile", "ext.cnf"]);

  server = https.createServer(
    { key: fs.readFileSync(path.join(dir, "srv.key")), cert: fs.readFileSync(path.join(dir, "srv.pem")) },
    (req, res) => {
      requests.push({ url: req.url, authorization: req.headers.authorization ?? null });
      res.end("ok");
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// The client must run asynchronously so this process keeps serving TLS.
async function runClient(host, extraEnv = {}) {
  const env = { PATH: process.env.PATH, ...extraEnv };
  const { stdout } = await execFileAsync(process.execPath, [CLIENT, `https://${host}:${port}/`], {
    env,
    timeout: 20000,
  });
  return JSON.parse(stdout);
}

const UNTRUSTED_CODES = ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"];

test("valid certificate for the requested hostname is accepted", { skip: SKIP, timeout: 30000 }, async () => {
  requests = [];
  const r = await runClient("kobo.test", { NODE_EXTRA_CA_CERTS: path.join(dir, "ca.pem") });
  assert.equal(r.status, 200);
  assert.equal(r.raw, "status_200");
  assert.equal(requests.length, 3);
});

test("certificate for a different hostname is rejected before any request is sent", { skip: SKIP, timeout: 30000 }, async () => {
  requests = [];
  const r = await runClient("other.test", { NODE_EXTRA_CA_CERTS: path.join(dir, "ca.pem") });
  assert.equal(r.error, "NETWORK");
  assert.equal(r.raw, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(r.rawOverride, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.deepEqual(requests, []);
});

test("certificate from an untrusted CA is rejected before any request is sent", { skip: SKIP, timeout: 30000 }, async () => {
  requests = [];
  const r = await runClient("kobo.test");
  assert.equal(r.error, "NETWORK");
  assert.ok(UNTRUSTED_CODES.includes(r.raw), r.raw);
  assert.ok(UNTRUSTED_CODES.includes(r.rawOverride), r.rawOverride);
  assert.deepEqual(requests, []);
});

test("NODE_TLS_REJECT_UNAUTHORIZED=0 cannot disable verification for this client", { skip: SKIP, timeout: 30000 }, async () => {
  requests = [];
  const untrusted = await runClient("kobo.test", { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.equal(untrusted.error, "NETWORK");
  assert.ok(UNTRUSTED_CODES.includes(untrusted.raw), untrusted.raw);
  assert.ok(UNTRUSTED_CODES.includes(untrusted.rawOverride), untrusted.rawOverride);

  const mismatch = await runClient("other.test", {
    NODE_EXTRA_CA_CERTS: path.join(dir, "ca.pem"),
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  });
  assert.equal(mismatch.error, "NETWORK");
  assert.equal(mismatch.raw, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.deepEqual(requests, []);
});
