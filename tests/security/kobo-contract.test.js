import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KOBO_ASSET_UID,
  KOBO_DATA_URL,
  buildAttachmentUrl,
  isAllowedKoboDataUrl,
  parseLegacyAttachmentUrl,
} from "../../api/_lib/kobo.js";

const SID = "123456789";
const UID = "attWNZNwhXK6HDYVkZJSn9jy";
const PATH = `/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/small/`;
const CANONICAL = `https://kf.kobotoolbox.org${PATH}`;

test("attachment URLs are built only from validated identifiers", () => {
  assert.equal(buildAttachmentUrl({ sid: SID, aid: UID, size: "small" }), CANONICAL);
  assert.equal(
    buildAttachmentUrl({ sid: "1", aid: "42", size: "large" }),
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/1/attachments/42/large/`,
  );
  for (const bad of [
    { sid: "abc", aid: UID, size: "small" },
    { sid: "1/2", aid: UID, size: "small" },
    { sid: "1234567890123", aid: UID, size: "small" },
    { sid: SID, aid: "../token", size: "small" },
    { sid: SID, aid: "att", size: "small" },
    { sid: SID, aid: "att%2e%2e%2fxx", size: "small" },
    { sid: SID, aid: UID, size: "original" },
    { sid: SID, aid: UID, size: "SMALL" },
    { sid: 1, aid: UID, size: "small" },
    null,
  ]) {
    assert.throws(() => buildAttachmentUrl(bad), /invalid_attachment_reference/);
  }
});

test("legacy URLs are accepted only in exact canonical form", () => {
  assert.deepEqual(parseLegacyAttachmentUrl(CANONICAL), { sid: SID, aid: UID, size: "small" });
  assert.deepEqual(parseLegacyAttachmentUrl(`${CANONICAL}?format=json`), { sid: SID, aid: UID, size: "small" });
  assert.deepEqual(
    parseLegacyAttachmentUrl(`https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/7/attachments/99/medium/`),
    { sid: "7", aid: "99", size: "medium" },
  );
});

test("legacy URLs that are not exactly canonical are rejected", () => {
  const rejected = [
    "https://attacker.example/x.jpg",
    `http://kf.kobotoolbox.org${PATH}`,
    `https://kf.kobotoolbox.org.evil.example${PATH}`,
    `https://kf.kobotoolbox.org@evil.example${PATH}`,
    `https://user:pass@kf.kobotoolbox.org${PATH}`,
    `https://evil.example/#${CANONICAL}`,
    `https://evil.example/?u=${CANONICAL}`,
    `https://KF.KOBOTOOLBOX.ORG${PATH}`,
    `https://kf.kobotoolbox.org.${PATH}`,
    `https://kf.kobotoolbox.org:8443${PATH}`,
    `https://kf.kobotoolbox.org:443${PATH}`,
    `https://104.16.0.1${PATH}`,
    `https://[::1]${PATH}`,
    `https://xn--kf-kobotoolbox-8kb.org${PATH}`,
    `https://kf.kobotoolbox.org/api/v2/assets/aOtherAsset1234567890/data/${SID}/attachments/${UID}/small/`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/original/`,
    `${CANONICAL}../../../../token/`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/%2e%2e/small/`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/${SID}/attachments/${UID}/small/x/../`,
    `${CANONICAL}?format=json&next=https://evil.example`,
    `${CANONICAL}?x=1`,
    `${CANONICAL}#frag`,
    `https://kf.kobo\ntoolbox.org${PATH}`,
    ` ${CANONICAL}`,
    `//kf.kobotoolbox.org${PATH}`,
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    `${CANONICAL}?format=json${"a".repeat(2100)}`,
    "",
    123,
    null,
  ];
  for (const raw of rejected) {
    assert.equal(parseLegacyAttachmentUrl(raw), null, String(raw).slice(0, 120));
  }
});

test("pagination URLs must use the exact origin, asset endpoint and Kobo parameters", () => {
  const base = `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/`;
  assert.equal(isAllowedKoboDataUrl(KOBO_DATA_URL), true);
  assert.equal(isAllowedKoboDataUrl(`${base}?format=json&limit=1000&start=1000`), true);
  assert.equal(isAllowedKoboDataUrl(`${base}?limit=30000&start=0&format=json`), true);

  // Unexpected keys with numeric values: rejected by the key allowlist alone
  // (the numeric value check would otherwise accept them).
  for (const extra of ["offset=5", "page=2", "page_size=2", "cursor=1", "fields=1", "query=1",
    "sort=1", "attachments=1", "format_=1", "Limit=1000", "start%5B%5D=1"]) {
    assert.equal(isAllowedKoboDataUrl(`${base}?format=json&limit=1000&start=1000&${extra}`), false, extra);
  }

  for (const raw of [
    `${base}?limit=1000&start=1000`, // format missing
    `${base}?format=xml&start=1000`,
    `${base}?format=json&start=-1`,
    `${base}?format=json&limit=ten`,
    `${base}?format=json&start=1&start=2`,
    `${base}?format=json&fields=["_id"]`,
    `${base}?format=json&query={}`,
    `http://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json&start=1`,
    `https://evil.example/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json&start=1`,
    `https://kf.kobotoolbox.org:444/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json`,
    `https://u:p@kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/?format=json`,
    `https://kf.kobotoolbox.org/api/v2/assets/aOtherAsset1234567890/data/?format=json`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/?format=json`,
    `https://kf.kobotoolbox.org/api/v2/assets/${KOBO_ASSET_UID}/data/1/?format=json`,
    `https://kf.kobotoolbox.org/token/?format=json`,
    `${base}?format=json#x`,
    "",
    null,
  ]) {
    assert.equal(isAllowedKoboDataUrl(raw), false, String(raw));
  }
});
