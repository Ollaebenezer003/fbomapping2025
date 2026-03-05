import { MdCancel } from "react-icons/md";
import { useState, useEffect } from "react";
import { IoIosSearch } from "react-icons/io";
import useFacilities from "../hooks/UseFacilities";
import { useFilters } from "../context/FilterContext";
import FacilityModal from "./FacilityModal";
import { CiGlobe } from "react-icons/ci";
import { FaHospital } from "react-icons/fa";
import { useModal } from "../context/ModalContext";

const SearchFBO = () => {
  const { data } = useFacilities();
  const { setFilters } = useFilters();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [modalData, setModalData] = useState(null);

  const { openModal } = useModal();

  // Extract facility name safely from either column
  const getFacilityName = (row) =>
    row["fbo_details/name_of_facility"]?.trim() ||
    row["fbo_details_non/name_of_organisation"]?.trim() ||
    "";

  // Update suggestions as user types
  useEffect(() => {
    if (!query || !data) {
      setSuggestions([]);
      return;
    }

    const userQuery = query.toLowerCase();

    // Match states
    const stateMatches = data
      .map((row) => row["state_and_lga/state"])
      .filter(Boolean)
      .filter((s, i, arr) => arr.indexOf(s) === i) // unique
      .filter((state) => state.toLowerCase().includes(userQuery))
      .map((state) => ({
        type: "state",
        label: state,
        item: state,
      }));

    // Unique state suggestions
    const uniqueStates = Array.from(
      new Map(stateMatches.map((item) => [item.text, item])).values(),
    );

    // Match facilities
    const facilityMatches = data
      .map((row) => ({
        ...row,
        facilityName: getFacilityName(row),
      }))
      .filter((row) => row.facilityName !== "")
      .filter((row) => row.facilityName.toLowerCase().includes(userQuery))
      .map((row) => ({
        type: "facility",
        label: row.facilityName,
        item: row, // full row for modal
      }));

    setSuggestions([...uniqueStates, ...facilityMatches]);
  }, [query, data]);

  // Handle clicks
  const handleSelect = (suggestion) => {
    if (suggestion.type === "state") {
      setFilters({ state: suggestion.item, lga: "" });
      setQuery(suggestion.item);
    } else if (suggestion.type === "facility") {
      openModal(suggestion.item);
      setQuery(suggestion.label);
    }

    setSuggestions([]);
  };

  // Process search form
  const handleSearch = async (e) => {
    e.preventDefault();
  };
  return (
    <div className="searchFormSection">
      <form className="searchForm" onSubmit={handleSearch}>
        <div className="searchSection">
          <input
            type="text"
            name="query"
            placeholder="Search for an FBO or location"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={1}
          />
          {query && (
            <button
              className="clearSearchBtn"
              type="button"
              onClick={() => {
                setQuery("");
                setSuggestions([]);
                setFilters({ state: "", lga: "" });
              }}
            >
              <MdCancel className="dropIcon" />
            </button>
          )}
          <button className="searchButton" type="submit">
            <IoIosSearch className="searchButtonIcon" />
          </button>

          {suggestions.length > 0 && (
            <div className="searchDropdown">
              {suggestions.map((item, index) => (
                <div
                  key={index}
                  onClick={() => handleSelect(item)}
                  className="dropdownItem"
                >
                  <span className="itemSuggest">
                    {item.type === "state" ? (
                      <CiGlobe className="locationIcons" />
                    ) : (
                      <FaHospital className="locationIcons" />
                    )}

                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {modalData && (
            <FacilityModal
              facility={modalData}
              onClose={() => setModalData(null)}
            />
          )}
        </div>
      </form>
    </div>
  );
};

export default SearchFBO;
