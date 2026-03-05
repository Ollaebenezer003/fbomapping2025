import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

import nigeriaStates from "../data/nga_admin1.json"; // same as in MapView
import nigeria from "../data/nga_admin0.json";
import { useFilters } from "../context/FilterContext";

export default function MapAutoZoom() {
  const map = useMap();
  const { filters } = useFilters();

  useEffect(() => {
    if (!map) return;

    if (filters.state) {
      // Find the selected state feature
      const stateFeature = nigeriaStates.features.find(
        (f) => f.properties.adm1_name === filters.state
      );

      if (stateFeature) {
        const layerBounds = L.geoJSON(stateFeature).getBounds();
        map.fitBounds(layerBounds, { padding: [50, 50] });
      }
    } else {
      // No state selected, zoom to full Nigeria
      const nigeriaBounds = L.geoJSON(nigeria).getBounds();
      map.fitBounds(nigeriaBounds, { padding: [50, 50] });
    }
  }, [filters.state, map]);

  return null; // no UI
}
