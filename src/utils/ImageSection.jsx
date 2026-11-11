import { useState, useEffect } from "react";
import ImagePreview from "./ImagePreview";
import { CgSpinner } from "react-icons/cg";
import { API_BASE } from "./apiBase";
import { buildMediaSrc, pickDisplayAttachment } from "./mediaUrl";

function ImageSection({ attachments, name, submissionId }) {
  const [showLoader, setShowLoader] = useState(true);

  // Images are requested by identifiers only; the server builds the Kobo URL.
  const attachment = pickDisplayAttachment(submissionId, attachments);
  const getMediaUrl = (size) =>
    buildMediaSrc(submissionId, attachment, size, API_BASE);

  // Hide loader after 4 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLoader(false);
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

  if (!attachment) return null;

  return (
    <section className="modalImageSection" style={{ position: "relative" }}>
      {showLoader && (
        <div className="imageLoader">
          <CgSpinner className="spinner" />
          <p>Loading images…</p>
        </div>
      )}

      <div
        className="modalImageContent"
        style={{ opacity: showLoader ? 0.3 : 1 }}
      >
        <ImagePreview
          src={getMediaUrl("small")}
          alt={name}
          className="modalImage"
        />

        <ImagePreview
          src={getMediaUrl("medium")}
          alt={name}
          className="modalImage"
        />

        <ImagePreview
          src={getMediaUrl("large")}
          alt={name}
          className="modalImage"
        />
      </div>
    </section>
  );
}

export default ImageSection;
