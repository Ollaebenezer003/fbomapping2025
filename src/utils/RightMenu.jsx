import { useFilters } from "../context/FilterContext";
import { computeStats } from "./ComputeStats";
import useFacilities from "../hooks/UseFacilities";

const RightMenu = () => {
  const { data, isLoading, error } = useFacilities();
  const { filters } = useFilters();

  if (isLoading) return <p>Loading Cards…</p>;
  if (error) return <p>Error loading data.</p>;

  if (!data) return <p>No data available</p>;

  // Compute stats on filtered data
  const stats = computeStats(data, filters);

  return (
    <div className="rightMenuContent">
      <div className="menuHeader">Overview</div>

      <div className="cardsContainer">
        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.stateCount}</span>
            <span className="cardSubtitle">No. of States Covered</span>
          </div>
        </div>

        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.total}</span>
            <span className="cardSubtitle">Total Mapped Infrastructures</span>
          </div>
        </div>

        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.totalFacilities}</span>
            <span className="cardSubtitle">No. of Facilities</span>
          </div>
        </div>

        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.totalNonFacilities}</span>
            <span className="cardSubtitle">No. of Non-Facilities</span>
          </div>
        </div>

        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.christianFBOs}</span>
            <span className="cardSubtitle">Christian Block FBOs</span>
          </div>
        </div>

        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.muslimFBOs}</span>
            <span className="cardSubtitle">Muslim Block FBOs</span>
          </div>
        </div>

        <div className="infoCard">
          <div className="infoCardText">
            <span>{stats.interfaithFBOs}</span>
            <span className="cardSubtitle">Inter-Faith FBOs</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RightMenu;
