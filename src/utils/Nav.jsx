import { NavLink } from "react-router-dom";
import SearchPhc from "./SearchFBO";

const Nav = () => {
  return (
    <div className="navContainer">
      <div className="navHeaderContainer">
        <div className="navHeaderText">
          National Agency for the Control of AIDS
        </div>
      </div>
      <div className="navMenuSection">
        <div className="navMenuContainer">
          <NavLink to="/">
            <img src="/icons/naca.png" alt="NACA" className="navImage" />
          </NavLink>
          <div className="navLink">
            <ul className="navLinkItems">
              <li>
                <NavLink to="https://naca.gov.ng/contact-us/" target="_blank">
                  NACA Support
                </NavLink>
              </li>
            </ul>
          </div>
        </div>

        <SearchPhc />
      </div>
    </div>
  );
};

export default Nav;
