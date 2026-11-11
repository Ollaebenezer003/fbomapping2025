import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMediaSrc, getAttachmentId, pickDisplayAttachment } from "../../src/utils/mediaUrl.js";

const UID = "attWNZNwhXK6HDYVkZJSn9jy";

test("builds identifier-only media URLs with no Kobo URL and no key", () => {
  const src = buildMediaSrc(123, { uid: UID, id: 9, download_small_url: "https://kf.kobotoolbox.org/x" }, "small");
  assert.equal(src, `/media?sid=123&aid=${UID}&size=small`);
  assert.doesNotMatch(src, /url=|key=|kobotoolbox/);
  assert.equal(buildMediaSrc("7", { id: 42 }, "large", "http://localhost:8080"), "http://localhost:8080/media?sid=7&aid=42&size=large");
});

test("prefers the attachment uid and falls back to the numeric id", () => {
  assert.equal(getAttachmentId({ uid: UID, id: 1 }), UID);
  assert.equal(getAttachmentId({ id: 1 }), "1");
  assert.equal(getAttachmentId({}), null);
  assert.equal(getAttachmentId(null), null);
});

test("returns null when identifiers are missing or invalid", () => {
  for (const [sid, att, size] of [
    [undefined, { uid: UID }, "small"],
    [null, { uid: UID }, "small"],
    ["abc", { uid: UID }, "small"],
    ["1;2", { uid: UID }, "small"],
    [1, {}, "small"],
    [1, { uid: "../x" }, "small"],
    [1, { uid: "att" }, "small"],
    [1, { uid: UID }, "original"],
    [1, null, "small"],
  ]) {
    assert.equal(buildMediaSrc(sid, att, size), null);
  }
});

test("chooses the first addressable image attachment", () => {
  const audio = { uid: "attAUDIOAUDIOAUDIOAUDIO1", mimetype: "audio/mp3" };
  const broken = { mimetype: "image/jpeg" };
  const photo = { uid: UID, mimetype: "image/jpeg" };
  assert.equal(pickDisplayAttachment(5, [audio, broken, photo]), photo);
  assert.equal(pickDisplayAttachment(5, [{ id: 3 }]).id, 3); // legacy record without mimetype
  assert.equal(pickDisplayAttachment(5, [audio]), null);
  assert.equal(pickDisplayAttachment(undefined, [photo]), null);
  assert.equal(pickDisplayAttachment(5, undefined), null);
});
