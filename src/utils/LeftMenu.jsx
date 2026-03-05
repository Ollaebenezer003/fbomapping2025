import { useFilters } from "../context/FilterContext";
import koboToGeoJson from "../hooks/KoboToGeoJson";
import useFacilities from "../hooks/UseFacilities";
import { useState, useEffect } from "react";
import { RxReset } from "react-icons/rx";
import CustomDropdown from "./CustomDropdown";

const LeftMenu = ({ onFilterChange }) => {
  const { data, isLoading, error } = useFacilities();
  const { filters, setFilters } = useFilters();
  const [selectedState, setSelectedState] = useState(filters.state || "");
  const [selectedLga, setSelectedLga] = useState(filters.lga || "");
  const [selectedCategories, setSelectedCategories] = useState(
    filters.category || [],
  );

  const [selectedBlock, setSelectedBlock] = useState(filters.block || []);

  // Update global filters when local selection changes
  useEffect(() => {
    setFilters({
      state: selectedState,
      lga: selectedLga,
      category: selectedCategories,
      block: selectedBlock,
    });
  }, [
    selectedState,
    selectedLga,
    selectedCategories,
    selectedBlock,
    setFilters,
  ]);

  if (isLoading) return <p>Loading Filters</p>;
  if (error) return <p>Error loading data.</p>;

  const geoJson = koboToGeoJson(data);

  if (!geoJson) return <p>No data available</p>;

  // Get unique states
  const states = [
    ...new Set(
      geoJson.features.map((f) => f.properties["state_and_lga/state"]),
    ),
  ].sort();

  // LGAs for selected state
  const lgas = selectedState
    ? [
        ...new Set(
          geoJson.features
            .filter(
              (f) => f.properties["state_and_lga/state"] === selectedState,
            )
            .map((f) => f.properties["state_and_lga/lga"]),
        ),
      ].sort()
    : [];

  // const filteredLgas = selectedState ? lgas[selectedState] || [] : [];

  const handleCategoryChange = (e) => {
    const value = e.target.value;
    setSelectedCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  };

  const handleBlockChange = (e) => {
    const value = e.target.value;
    setSelectedBlock((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  };

  const resetFilters = (e) => {
    e.preventDefault();
    setSelectedState("");
    setSelectedLga("");
    setSelectedCategories([]);
    setSelectedBlock([]);
    setFilters({ state: "", lga: "", category: [], block: [] });
  };

  return (
    <div className="leftMenuContent">
      <form className="leftMenuForm">
        <div className="menuHeader">Location</div>

        <div className="subMenuHeader">
          Please select a state and LGA to filter the map
        </div>

        <div className="selectorContainer">
          <label>State</label>
          <CustomDropdown
            options={states}
            value={selectedState}
            setValue={(val) => {
              setSelectedState(val);
              setSelectedLga(""); // reset LGA
            }}
            placeholder="Select a state"
          />

          <label>LGA</label>
          <CustomDropdown
            options={lgas}
            value={selectedLga}
            setValue={setSelectedLga}
            placeholder="Select an LGA"
            disabled={!selectedState}
          />
        </div>

        <div className="menuHeader" id="catSpacing">
          Category
        </div>
        <div className="subMenuHeader">
          Please select a category of FBO to filter the map
        </div>
        <div className="checkboxContent">
          {["Facility", "Non-Facility"].map((cat) => (
            <div className="checkboxRow" id="categorySpacing" key={cat}>
              <span>
                <input
                  type="checkbox"
                  className="checkboxItem"
                  value={cat}
                  checked={selectedCategories.includes(cat)}
                  onChange={handleCategoryChange}
                />
              </span>
              <span className="checkboxLabel">{cat}</span>
              <span
                className={
                  cat === "Facility"
                    ? "checkboxLegendFacility"
                    : "checkboxLegendNonFacility"
                }
              ></span>
            </div>
          ))}
        </div>

        <div className="menuHeader" id="catSpacing">
          Blocks
        </div>
        <div className="subMenuHeader">
          Please select an FBO Block to filter the map
        </div>
        <div className="checkboxContent">
          {["Christian", "Muslim", "Inter-Faith"].map((bloc) => (
            <div className="checkboxRow" key={bloc}>
              <span>
                <input
                  type="checkbox"
                  className="checkboxItem"
                  value={bloc}
                  checked={selectedBlock.includes(bloc)}
                  onChange={handleBlockChange}
                />
              </span>
              <span className="checkboxLabel">{bloc}</span>
            </div>
          ))}
        </div>

        <div className="resetBtnContent">
          <button onClick={resetFilters}>
            <RxReset className="resetButtonIcon" />
            <span>Reset Filters</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default LeftMenu;
