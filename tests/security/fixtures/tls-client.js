// Child-process TLS client used by tls-verification.test.js.
// Runs in its own process so NODE_EXTRA_CA_CERTS and
// NODE_TLS_REJECT_UNAUTHORIZED apply exactly as they would in production.
// Every hostname resolves to 127.0.0.1 (local test server only).
//
// Usage: node tls-client.js <https-url>
// Prints JSON: { status | error, raw, rawOverride }

import https from "node:https";
import process from "node:process";
import { createGuardedAgent, createGuardedGet } from "../../../api/_lib/safeHttp.js";

const url = process.argv[2];
const lookup = (hostname, options, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]);
const isAllowed = (address) => address === "127.0.0.1";

const result = {};

// 1. The production client path (createGuardedGet over HTTPS).
try {
  const res = await createGuardedGet({ isAllowed, lookup })(url, {
    headers: { Authorization: "Token TLS_CLIENT_SENTINEL" },
    timeoutMs: 5000,
  });
  result.status = res.status;
} catch (err) {
  result.error = err.code;
}

// 2. Same agent, raw request, to expose the underlying TLS error code.
// 3. Same agent, with a request-level attempt to disable verification.
function raw(extraOptions) {
  const agent = createGuardedAgent(https.Agent, { isAllowed, lookup });
  return new Promise((resolve) => {
    const req = https.request(url, { agent, ...extraOptions }, (res) => {
      res.resume();
      resolve(`status_${res.statusCode}`);
    });
    req.on("error", (err) => resolve(err.code ?? "error"));
    req.end();
  });
}
result.raw = await raw({});
result.rawOverride = await raw({ rejectUnauthorized: false });

process.stdout.write(JSON.stringify(result));
