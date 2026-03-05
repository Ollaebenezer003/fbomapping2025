export default function koboToGeoJson(koboData) {
  const dataArray = Array.isArray(koboData)
    ? koboData
    : koboData?.results || [];

  const features = dataArray
    .map((item) => {
      let lat = null;
      let lng = null;

      // CASE A — Your actual Kobo field: "6.4265 7.4864 247 5"
      if (item["collect_gps/final_geopoint"]) {
        const parts = item["collect_gps/final_geopoint"]
          .split(" ")
          .map((x) => parseFloat(x));

        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          lat = parts[0];
          lng = parts[1];
        }
      }

      // CASE B — Fallback: Kobo _geolocation array
      if (
        (!lat || !lng) &&
        Array.isArray(item._geolocation) &&
        item._geolocation.length >= 2 &&
        item._geolocation[0] &&
        item._geolocation[1]
      ) {
        lat = parseFloat(item._geolocation[0]);
        lng = parseFloat(item._geolocation[1]);
      }

      // If still invalid, skip
      if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat], // GeoJSON = [lng, lat]
        },
        properties: {
          ...item,
          attachments: item._attachments || [],
        },
      };
    })
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features,
  };
}
