import { useState, useEffect } from "react";
import ImagePreview from "./ImagePreview";
import { CgSpinner } from "react-icons/cg";

function ImageSection({ attachments, name }) {
  const [showLoader, setShowLoader] = useState(true);

  const baseUrl = import.meta.env.VITE_API_URL;
  const apiKey = import.meta.env.VITE_API_KEY;

  const getMediaUrl = (url) =>
    `${baseUrl}/media?url=${encodeURIComponent(url)}&key=${apiKey}`;

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
          src={getMediaUrl(attachments[0].download_small_url)}
          alt={name}
          className="modalImage"
        />

        <ImagePreview
          src={getMediaUrl(attachments[0].download_medium_url)}
          alt={name}
          className="modalImage"
        />

        <ImagePreview
          src={getMediaUrl(attachments[0].download_large_url)}
          alt={name}
          className="modalImage"
        />
      </div>
    </section>
  );
}

export default ImageSection;
