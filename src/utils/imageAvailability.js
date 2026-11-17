// Tracks which image sizes failed to load in the facility modal.
// Pure functions, so the logic can be tested without a browser.

export const IMAGE_SIZES = Object.freeze(["small", "medium", "large"]);

export const UNAVAILABLE_TITLE = "Image unavailable";
export const UNAVAILABLE_TEXT = "This photo cannot be shown at the moment.";

/** Return the failed-size list with `size` added. Unknown sizes are ignored. */
export function markImageFailed(failed, size) {
  const list = Array.isArray(failed) ? failed : [];
  if (!IMAGE_SIZES.includes(size) || list.includes(size)) return list;
  return [...list, size];
}

/** True when every size failed, so the section shows the unavailable state. */
export function allImagesFailed(failed) {
  return Array.isArray(failed) && IMAGE_SIZES.every((size) => failed.includes(size));
}
