import {
  MapContainer,
  TileLayer,
  Marker,
  GeoJSON,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
// import { useState } from "react";
import useFacilities from "./hooks/UseFacilities";
import koboToGeoJson from "./hooks/KoboToGeoJson";
import MapAutoZoom from "./hooks/MapAutoZoom";
import { useFilters } from "./context/FilterContext";
import nigeria from "./data/nga_admin0.json";
import nigeriaStates from "./data/nga_admin1.json";
import FacilityModal from "./utils/FacilityModal";
import { useModal } from "./context/ModalContext";
import MarkerClusterGroup from "react-leaflet-cluster";
// import { dataVariables } from "./utils/DataVariables";

// Fix Leaflet default icons not displaying
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// =============================
// CUSTOM MARKER ICONS
// =============================
const facilityIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const nonFacilityIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function MapView() {
  // =============================================================
  // Facility Modal States
  // =============================================================
  const { modalOpen, modalData, openModal, closeModal } = useModal();

  // =============================================================
  // Data Loading States
  // =============================================================
  const { data, isLoading, error } = useFacilities();
  const { filters } = useFilters();

  const Loader = () => (
    <div className="loaderContainer">
      <div className="rollingLoader"></div>
      <span>Loading Datasets...</span>
    </div>
  );

  if (error) return <p>Error loading data.</p>;

  const geoJson = koboToGeoJson(data);

  if (!geoJson) return <p>No data available</p>;

  // =============================================================
  // FILTER FACILITIES BASED ON MENU SELECTION
  // =============================================================
  const filteredFeatures = geoJson.features.filter((f) => {
    const props = f.properties;

    const stateMatch =
      !filters.state || props["state_and_lga/state"] === filters.state;
    const lgaMatch = !filters.lga || props["state_and_lga/lga"] === filters.lga;

    const categoryMatch =
      !filters.category ||
      filters.category.length === 0 ||
      filters.category.includes(props["category_of_fbo/fbo_category"]);

    const blockMatch =
      !filters.block ||
      filters.block.length === 0 ||
      filters.block.includes(props["category_of_fbo/fbo_block"]);

    return stateMatch && lgaMatch && categoryMatch && blockMatch;
  });

  // =============================================================
  // NIGERIA STYLE
  // =============================================================
  const nigeriaStyle = {
    color: "red",
    weight: 3,
    fillColor: "#5c3f14ff",
    fillOpacity: 0.15,
  };

  // =============================================================
  // STATES STYLING
  // =============================================================
  const defaultStateStyle = {
    color: "#130e12ff",
    weight: 1,
    fill: false,
  };

  const highlightStyle = {
    color: "#184c4eff",
    weight: 3,
    fillColor: "#184c4eff",
    fillOpacity: 0.4,
  };

  // Style function applied to each state feature
  const onEachState = (feature, layer) => {
    const stateName = feature.properties.adm1_name;

    // determine style
    if (!filters.state) {
      layer.setStyle(defaultStateStyle);
    } else if (filters.state === stateName) {
      layer.setStyle(highlightStyle);
    } else {
      layer.setStyle({
        color: "#ccc",
        weight: 0.5,
        fillOpacity: 0,
      });
    }

    // OPTIONAL tooltip for state names
    // layer.bindTooltip(stateName, {
    //   permanent: true,
    //   direction: "center",
    //   className: "state-label",
    // });
  };

  return (
    <div style={{ flex: 1, height: "100%", width: "100%" }}>
      {isLoading && <Loader />}
      <MapContainer
        center={[9.082, 8.6753]} // Nigeria center
        zoom={7}
        style={{ height: "100%", width: "100%" }}
      >
        <MapAutoZoom />
        <LayersControl position="bottomleft">
          {/* Default Layer */}
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              subdomains={["mt0", "mt1", "mt2", "mt3"]}
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Terrain">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}"
              subdomains={["mt0", "mt1", "mt2", "mt3"]}
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Topo">
            <TileLayer
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              subdomains={["a", "b", "c"]}
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Streets">
            <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png" />
          </LayersControl.BaseLayer>

          {/* Overlay: Nigeria Highlight */}
          <LayersControl.Overlay checked name="Nigeria Boundary">
            <GeoJSON data={nigeria} style={() => nigeriaStyle} />
          </LayersControl.Overlay>

          {/* Overlay: Nigerian States Highlight */}
          <LayersControl.Overlay checked name="State Boundary">
            <GeoJSON
              key={filters.state || "all"}
              data={nigeriaStates}
              onEachFeature={onEachState}
            />
          </LayersControl.Overlay>
        </LayersControl>

        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={30}
          showCoverageOnHover={false}
        >
          {filteredFeatures.map((feature, i) => {
            const [lng, lat] = feature.geometry.coordinates;
            const facility = feature.properties;

            const category = facility["category_of_fbo/fbo_category"];

            const markerIcon =
              category === "Facility" ? facilityIcon : nonFacilityIcon;

            return (
              <Marker
                key={i}
                position={[lat, lng]}
                icon={markerIcon}
                eventHandlers={{
                  click: () => openModal(facility),
                }}
              />
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>
      <FacilityModal
        open={modalOpen}
        onClose={closeModal}
        facility={modalData}
      />
    </div>
  );
}
