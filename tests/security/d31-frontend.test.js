// D31 front-end checks. Pure logic is tested directly. JSX files cannot run
// under node:test without a build step, so their safety properties are
// checked by reading the source. No browser is used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMediaSrc, pickDisplayAttachment } from "../../src/utils/mediaUrl.js";
import {
  IMAGE_SIZES,
  UNAVAILABLE_TEXT,
  UNAVAILABLE_TITLE,
  allImagesFailed,
  markImageFailed,
} from "../../src/utils/imageAvailability.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

test("D31-T20: the front end works with the projected /facilities attachment shape", () => {
  const projected = [
    { uid: "attFacilityPhoto00000001", id: 11, mimetype: "image/jpeg" },
    { uid: "attOrganisationPhoto0002", id: 12, mimetype: "image/jpeg" },
  ];
  const chosen = pickDisplayAttachment(424242, projected);
  assert.equal(chosen, projected[0]);
  for (const size of IMAGE_SIZES) {
    assert.equal(
      buildMediaSrc(424242, chosen, size),
      `/media?sid=424242&aid=attFacilityPhoto00000001&size=${size}`,
    );
  }
  assert.equal(pickDisplayAttachment(424242, []), null, "no authorised attachment: no image section");
});

test("image failure UX: the section shows the unavailable state only when every size fails", () => {
  let failed = [];
  assert.equal(allImagesFailed(failed), false);
  failed = markImageFailed(failed, "small");
  failed = markImageFailed(failed, "small"); // repeated error event
  assert.deepEqual(failed, ["small"]);
  assert.equal(allImagesFailed(failed), false, "one failed size hides only that thumbnail");
  failed = markImageFailed(failed, "original"); // unknown size ignored
  failed = markImageFailed(failed, "medium");
  assert.equal(allImagesFailed(failed), false);
  failed = markImageFailed(failed, "large");
  assert.equal(allImagesFailed(failed), true);
  assert.equal(allImagesFailed(null), false);
  assert.deepEqual(markImageFailed(undefined, "small"), ["small"]);
  assert.equal(UNAVAILABLE_TITLE, "Image unavailable");
  assert.doesNotMatch(UNAVAILABLE_TEXT, /404|503|error|Kobo/i, "no technical detail in the message");
});

test("image failure UX: the full-screen viewer handles a failed image and stays closable", () => {
  const preview = read("utils/ImagePreview.jsx");
  // The full image has its own error handler that switches to the unavailable state.
  assert.match(preview, /className="fullImage"[\s\S]{0,80}onError=\{\(\) => setFullFailed\(true\)\}/);
  assert.match(preview, /fullFailed \?[\s\S]*className="imageUnavailable" role="status"/);
  // The state resets each time the viewer opens.
  assert.match(preview, /const openPreview = \(\) => \{\s*setFullFailed\(false\);\s*setOpen\(true\);/);
  // Close paths: overlay click, close button, Escape key, and the button in the unavailable state.
  assert.match(preview, /className="imageModalOverlay"[\s\S]{0,120}onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(preview, /aria-label="Close photo preview"/);
  assert.match(preview, /e\.key === "Escape"\) setOpen\(false\)/);
  assert.match(preview, /className="imageUnavailableClose"\s*onClick=\{\(\) => setOpen\(false\)\}/);
  // A failed thumbnail hides itself and reports to the section.
  assert.match(preview, /setFailed\(true\);\s*onUnavailable\?\.\(\);/);

  const section = read("utils/ImageSection.jsx");
  assert.match(section, /allImagesFailed\(failedSizes\)/);
  assert.match(section, /markImageFailed\(prev, size\)/);

  const css = read("index.css");
  for (const cls of ["imageUnavailable", "imageUnavailableInline", "imageUnavailableTitle", "imageUnavailableText", "imageUnavailableClose"]) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), cls);
  }
});

test("view-only GIS: no image download or deletion feature in the front end", () => {
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /<[A-Za-z][^>]*\sdownload(\s*=|[\s/>])/, `download attribute in ${file}`);
    assert.doesNotMatch(src, /method:\s*["'](DELETE|PUT|POST|PATCH)["']/i, `write method in ${file}`);
    assert.doesNotMatch(src, /\baxios\.(delete|put|post|patch)\s*\(/, `write call in ${file}`);
    assert.doesNotMatch(src, /createObjectURL|toDataURL|saveAs\s*\(/, `file export in ${file}`);
  }
  for (const rel of ["utils/ImagePreview.jsx", "utils/ImageSection.jsx"]) {
    assert.doesNotMatch(read(rel), /[Dd]elete|[Dd]ownload|[Rr]emove(?!EventListener)/, rel);
  }
});
