// Shared test helpers. No test performs real network access: upstream calls
// are served by injected fakes or by local servers bound to 127.0.0.1.

import { Buffer } from "node:buffer";
import { createApp } from "../../api/_lib/app.js";

// Sentinel credential. Tests assert it never appears in responses or logs,
// and is only ever sent in the Authorization header of canonical requests.
export const TOKEN = "SENTINEL_KOBO_TOKEN_7f3a9c51e2";
export const API_KEY = "test-public-key";

export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
export const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);
export const HTML = Buffer.from("<!doctype html><script>alert(document.domain)</script>");
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

export function captureLog() {
  const lines = [];
  const rec =
    (level) =>
    (...args) =>
      lines.push(`${level} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ")}`);
  return { log: { log: rec("log"), info: rec("info"), warn: rec("warn"), error: rec("error") }, lines };
}

export function fakeGet(responder) {
  const calls = [];
  const get = async (url, opts) => {
    calls.push({ url, opts });
    return responder(url, opts, calls.length);
  };
  return { get, calls };
}

export function ok(body, contentType) {
  return { status: 200, headers: { "content-type": contentType }, body };
}

export async function startApp({ get, env, log }) {
  const app = createApp({ get, env, log });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

export async function fetchAll(res) {
  const body = Buffer.from(await res.arrayBuffer());
  const headers = Object.fromEntries(res.headers.entries());
  return { status: res.status, headers, body };
}
