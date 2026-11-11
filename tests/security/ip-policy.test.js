import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress } from "../../api/_lib/safeHttp.js";

test("non-public IPv4 addresses are rejected", () => {
  for (const a of [
    "0.0.0.0", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1",
    "127.1.2.3", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1",
    "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ]) {
    assert.equal(isPublicAddress(a), false, a);
  }
});

test("non-public IPv6 addresses are rejected, including mapped and embedded IPv4", () => {
  for (const a of [
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::ffff:192.168.0.1", "::127.0.0.1", "64:ff9b::a00:1", "64:ff9b::808:808", "fc00::1",
    "fd12:3456:789a::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1", "2001::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2002:7f00:1::1", "3fff::1", "100::1",
  ]) {
    assert.equal(isPublicAddress(a), false, a);
  }
});

test("malformed or non-IP values are rejected", () => {
  for (const a of [
    "", "localhost", "kf.kobotoolbox.org", "0177.0.0.1", "0x7f.0.0.1", "2130706433", "127.1",
    "1.2.3.4.5", "256.1.1.1", "fe80::1%eth0", "::ffff:999.0.0.1", "[::1]", null, undefined, 42,
  ]) {
    assert.equal(isPublicAddress(a), false, String(a));
  }
});

test("public unicast addresses are accepted", () => {
  for (const a of [
    "1.1.1.1", "8.8.8.8", "104.16.0.1", "172.15.255.255", "172.32.0.1", "100.63.255.255",
    "100.128.0.1", "::ffff:8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e",
  ]) {
    assert.equal(isPublicAddress(a), true, a);
  }
});
