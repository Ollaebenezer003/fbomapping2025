import { useEffect, useState } from "react";
import { ImageOff, X } from "lucide-react";
import { FaEye } from "react-icons/fa";
import { UNAVAILABLE_TEXT, UNAVAILABLE_TITLE } from "./imageAvailability";

// View-only image preview (D31 requirements 4 and 5).
const ImagePreview = ({ src, alt, onUnavailable }) => {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fullFailed, setFullFailed] = useState(false);

  // Close the full-screen view with the Escape key.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Hide the thumbnail when the image is missing or unavailable.
  if (!src || failed) return null;

  const openPreview = () => {
    setFullFailed(false);
    setOpen(true);
  };

  return (
    <>
      {/* Thumbnail with hover preview overlay */}
      <div
        className="imageWrapper"
        role="button"
        tabIndex={0}
        aria-label={`Preview photo of ${alt || "facility"}`}
        onClick={openPreview}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPreview();
          }
        }}
      >
        <img
          src={src}
          alt={alt}
          className="modalImage"
          onError={() => {
            setFailed(true);
            onUnavailable?.();
          }}
        />

        <div className="imageOverlay">
          <div className="imageOverlayContent">
            <FaEye className="previewIcon" />
            <span className="previewText">Preview</span>
          </div>
        </div>
      </div>

      {/* Full-screen overlay modal */}
      {open && (
        <div
          className="imageModalOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="closeImageBtn"
            aria-label="Close photo preview"
            onClick={(e) => {
              e.stopPropagation(); // prevents closing when clicking the image
              setOpen(false);
            }}
          >
            <X className="closeImageIcon" />
          </button>

          <div
            className="imageModalContent"
            onClick={(e) => e.stopPropagation()}
          >
            {fullFailed ? (
              <div className="imageUnavailable" role="status">
                <ImageOff className="imageUnavailableIcon" aria-hidden="true" />
                <p className="imageUnavailableTitle">{UNAVAILABLE_TITLE}</p>
                <p className="imageUnavailableText">{UNAVAILABLE_TEXT}</p>
                <button
                  type="button"
                  className="imageUnavailableClose"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
              </div>
            ) : (
              <img
                src={src}
                alt={alt}
                className="fullImage"
                onError={() => setFullFailed(true)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ImagePreview;
