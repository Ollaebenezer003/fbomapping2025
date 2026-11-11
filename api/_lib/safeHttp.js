// Outbound HTTP client used for every authenticated KoboToolbox request.
//
// Guarantees:
// - Never follows redirects (node:http/https do not follow them; 3xx is
//   returned to the caller, which rejects it).
// - Ignores HTTP(S)_PROXY environment variables (a dedicated agent is used).
// - Only connects to public unicast addresses. The check runs inside the
//   agent's DNS lookup, i.e. on the exact addresses the socket will use, so a
//   DNS answer cannot change between "check" and "connect" (DNS rebinding).
//   IP-literal hosts are checked before connecting, and the connected peer
//   address is verified again once the socket is established.
// - Enforces an overall deadline and a cap on the decoded body size.

import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class UpstreamError extends Error {
  constructor(code) {
    super(`upstream_${code}`);
    this.name = "UpstreamError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Address policy
// ---------------------------------------------------------------------------

function parseIPv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const out = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function expandIPv6(value) {
  if (!net.isIPv6(value) || value.includes("%")) return null;
  let str = value;
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(str);
  if (dotted) {
    const v4 = parseIPv4(dotted[2]);
    if (!v4) return null;
    str =
      dotted[1] +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array(fill).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function isPublicIPv4([a, b, c]) {
  if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicIPv6(h) {
  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isPublicIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  // Only global unicast (2000::/3). This excludes ::, ::1, IPv4-compatible,
  // NAT64 (64:ff9b::/96), ULA (fc00::/7), link-local (fe80::/10),
  // site-local and multicast.
  if ((h[0] & 0xe000) !== 0x2000) return false;
  if (h[0] === 0x2001 && h[1] < 0x0200) return false; // 2001::/23 incl. Teredo, ORCHID
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // documentation
  if (h[0] === 0x2002) return false; // 6to4 (embeds arbitrary IPv4)
  if (h[0] === 0x3fff && h[1] < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  const family = net.isIP(address);
  if (family === 4) {
    const v4 = parseIPv4(address);
    return v4 ? isPublicIPv4(v4) : false;
  }
  if (family === 6) {
    const v6 = expandIPv6(address);
    return v6 ? isPublicIPv6(v6) : false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Guarded DNS lookup and agent
// ---------------------------------------------------------------------------

export function createGuardedLookup({ isAllowed = isPublicAddress, lookup = dns.lookup } = {}) {
  return function guardedLookup(hostname, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    } else if (typeof opts === "number") {
      opts = { family: opts };
    }
    opts = opts ?? {};
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [];
      // Reject the whole answer if any record is non-public, so a mixed
      // answer cannot be used to reach an internal address.
      if (list.length === 0 || list.some((a) => !isAllowed(a?.address))) {
        return cb(new UpstreamError("BLOCKED_ADDRESS"));
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

// Certificate and hostname verification are forced on every TLS connection.
// Explicit options take precedence over NODE_TLS_REJECT_UNAUTHORIZED, so the
// environment cannot silently disable verification for this client. They are
// ignored by plain TCP connections (local test transport only).
const TLS_VERIFICATION = Object.freeze({
  rejectUnauthorized: true,
  checkServerIdentity: tls.checkServerIdentity,
});

export function createGuardedAgent(AgentClass, { isAllowed = isPublicAddress, lookup } = {}) {
  const guardedLookup = createGuardedLookup({ isAllowed, lookup });

  class GuardedAgent extends AgentClass {
    createConnection(options, callback) {
      const host = options.host ?? options.hostname;
      if (net.isIP(host) && !isAllowed(host)) {
        // Signal the error through the agent callback; no socket is created.
        callback(new UpstreamError("BLOCKED_ADDRESS"));
        return undefined;
      }
      const socket = super.createConnection({ ...options, ...TLS_VERIFICATION, lookup: guardedLookup });
      socket.once("connect", () => {
        const peer = socket.remoteAddress;
        if (peer && !isAllowed(peer)) socket.destroy(new UpstreamError("BLOCKED_ADDRESS"));
      });
      return socket;
    }
  }

  return new GuardedAgent({ keepAlive: false, ...TLS_VERIFICATION });
}

// ---------------------------------------------------------------------------
// Bounded GET
// ---------------------------------------------------------------------------

function toUpstreamError(err) {
  if (err instanceof UpstreamError) return err;
  const code = err?.code;
  if (code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET" || err?.message === "aborted") {
    return new UpstreamError("ABORTED");
  }
  if (typeof code === "string" && code.startsWith("Z_")) return new UpstreamError("DECODE");
  return new UpstreamError("NETWORK");
}

function createDecoder(contentEncoding) {
  const enc = String(contentEncoding ?? "identity").trim().toLowerCase();
  if (enc === "" || enc === "identity") return null;
  if (enc === "gzip" || enc === "x-gzip") return zlib.createGunzip();
  if (enc === "deflate") return zlib.createInflate();
  if (enc === "br") return zlib.createBrotliDecompress();
  throw new UpstreamError("UNSUPPORTED_ENCODING");
}

/**
 * Create a GET function bound to a guarded agent.
 * `transport` and the address policy are injectable for local tests only.
 */
export function createGuardedGet({ transport = https, isAllowed = isPublicAddress, lookup } = {}) {
  const agent = createGuardedAgent(transport.Agent, { isAllowed, lookup });

  return function guardedGet(url, { headers = {}, timeoutMs = 8000, maxBytes = 4 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let timer;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      let req;
      try {
        req = transport.request(url, { method: "GET", agent, headers }, (res) => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            // Do not read or follow non-2xx bodies (including 3xx redirects).
            res.destroy();
            finish(resolve, { status, headers: res.headers, body: Buffer.alloc(0) });
            return;
          }

          const declared = Number(res.headers["content-length"]);
          if (Number.isFinite(declared) && declared > maxBytes) {
            res.destroy();
            finish(reject, new UpstreamError("TOO_LARGE"));
            return;
          }

          let decoder;
          try {
            decoder = createDecoder(res.headers["content-encoding"]);
          } catch (err) {
            res.destroy();
            finish(reject, toUpstreamError(err));
            return;
          }

          const chunks = [];
          let total = 0;
          const sink = new Writable({
            write(chunk, _encoding, done) {
              total += chunk.length;
              if (total > maxBytes) return done(new UpstreamError("TOO_LARGE"));
              chunks.push(chunk);
              return done();
            },
          });

          const streams = decoder ? [res, decoder, sink] : [res, sink];
          pipeline(...streams).then(
            () => finish(resolve, { status, headers: res.headers, body: Buffer.concat(chunks, total) }),
            (err) => finish(reject, timedOut ? new UpstreamError("TIMEOUT") : toUpstreamError(err)),
          );
        });
      } catch (err) {
        finish(reject, toUpstreamError(err));
        return;
      }

      timer = setTimeout(() => {
        timedOut = true;
        req.destroy(new UpstreamError("TIMEOUT"));
        finish(reject, new UpstreamError("TIMEOUT"));
      }, timeoutMs);

      req.on("error", (err) => finish(reject, timedOut ? new UpstreamError("TIMEOUT") : toUpstreamError(err)));
      req.end();
    });
  };
}

// Production client: HTTPS only, public addresses only.
export const guardedGet = createGuardedGet();
