import useFacilities from "./hooks/UseFacilities";
import MapView from "./MapView";
import LeftMenu from "./utils/LeftMenu";
import RightMenu from "./utils/RightMenu";
import Nav from "./utils/Nav";

const Home = () => {
  useFacilities();
  return (
    <div className="pageContainer">
      <Nav />
      <div className="pageContent">
        <div className="rightMenuContainer">
          <RightMenu />
        </div>
        <div className="mainMenuContainer">
          <MapView />
        </div>
        <div className="leftMenuContainer">
          <LeftMenu />
        </div>
      </div>
    </div>
  );
};

export default Home;
