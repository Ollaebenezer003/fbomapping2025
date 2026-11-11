// Builds identifier-based image URLs for the /media proxy. The browser never
// sends Kobo URLs; the server rebuilds the upstream URL from these values.

const SUBMISSION_ID_RE = /^\d{1,12}$/;
const ATTACHMENT_ID_RE = /^(?:att[A-Za-z0-9]{8,64}|\d{1,12})$/;
const SIZES = new Set(["small", "medium", "large"]);

export function getAttachmentId(attachment) {
  const id = attachment?.uid ?? attachment?.id;
  return id === undefined || id === null ? null : String(id);
}

function isImageAttachment(attachment) {
  const type = attachment?.mimetype;
  return !type || String(type).toLowerCase().startsWith("image/");
}

export function buildMediaSrc(submissionId, attachment, size, base = "") {
  const sid = submissionId === undefined || submissionId === null ? "" : String(submissionId);
  const aid = getAttachmentId(attachment);
  if (!SUBMISSION_ID_RE.test(sid) || !aid || !ATTACHMENT_ID_RE.test(aid) || !SIZES.has(size)) {
    return null;
  }
  const params = new URLSearchParams({ sid, aid, size });
  return `${base}/media?${params.toString()}`;
}

/** First image attachment that can be addressed by identifiers, or null. */
export function pickDisplayAttachment(submissionId, attachments) {
  if (!Array.isArray(attachments)) return null;
  return (
    attachments.find(
      (a) => isImageAttachment(a) && buildMediaSrc(submissionId, a, "small") !== null,
    ) ?? null
  );
}
