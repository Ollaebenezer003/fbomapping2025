import { useState, useEffect } from "react";
import { ImageOff } from "lucide-react";
import ImagePreview from "./ImagePreview";
import { CgSpinner } from "react-icons/cg";
import { API_BASE } from "./apiBase";
import { buildMediaSrc, pickDisplayAttachment } from "./mediaUrl";
import {
  IMAGE_SIZES,
  UNAVAILABLE_TEXT,
  UNAVAILABLE_TITLE,
  allImagesFailed,
  markImageFailed,
} from "./imageAvailability";

function ImageSection({ attachments, name, submissionId }) {
  const [showLoader, setShowLoader] = useState(true);
  const [failedSizes, setFailedSizes] = useState([]);

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

  // Every size failed (for example 404 or 503): show one calm message.
  // The rest of the modal stays usable.
  if (allImagesFailed(failedSizes)) {
    return (
      <section className="modalImageSection">
        <div className="imageUnavailable imageUnavailableInline" role="status">
          <ImageOff className="imageUnavailableIcon" aria-hidden="true" />
          <p className="imageUnavailableTitle">{UNAVAILABLE_TITLE}</p>
          <p className="imageUnavailableText">{UNAVAILABLE_TEXT}</p>
        </div>
      </section>
    );
  }

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
        {IMAGE_SIZES.map((size) => (
          <ImagePreview
            key={size}
            src={getMediaUrl(size)}
            alt={name}
            onUnavailable={() =>
              setFailedSizes((prev) => markImageFailed(prev, size))
            }
          />
        ))}
      </div>
    </section>
  );
}

export default ImageSection;
