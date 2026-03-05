import { useState, useEffect } from "react";
import ImagePreview from "./ImagePreview";
import { CgSpinner } from "react-icons/cg";

function ImageSection({ attachments, name }) {
  const [showLoader, setShowLoader] = useState(true);

  // Hide loader after 4 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLoader(false);
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

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
          src={`http://localhost:8082/media?url=${encodeURIComponent(
            attachments[0].download_small_url
          )}`}
          alt={name}
          className="modalImage"
        />

        <ImagePreview
          src={`http://localhost:8082/media?url=${encodeURIComponent(
            attachments[0].download_medium_url
          )}`}
          alt={name}
          className="modalImage"
        />

        <ImagePreview
          src={`http://localhost:8082/media?url=${encodeURIComponent(
            attachments[0].download_large_url
          )}`}
          alt={name}
          className="modalImage"
        />
      </div>
    </section>
  );
}

export default ImageSection;
