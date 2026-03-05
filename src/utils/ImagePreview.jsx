import { useState } from "react";
import { X } from "lucide-react";
import { FaEye } from "react-icons/fa";

const ImagePreview = ({ src, alt }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Thumbnail with hover preview overlay */}
      <div className="imageWrapper" onClick={() => setOpen(true)}>
        <img src={src} alt={alt} className="modalImage" />

        <div className="imageOverlay">
          <div className="imageOverlayContent">
            <FaEye className="previewIcon" />
            <span className="previewText">Preview</span>
          </div>
        </div>
      </div>

      {/* Full-screen overlay modal */}
      {open && (
        <div className="imageModalOverlay" onClick={() => setOpen(false)}>
          <button
            className="closeImageBtn"
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
            <img src={src} alt={alt} className="fullImage" />
          </div>
        </div>
      )}
    </>
  );
};

export default ImagePreview;
