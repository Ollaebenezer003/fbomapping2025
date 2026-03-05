import { useState } from "react";
import { IoIosSearch } from "react-icons/io";
import { MdCancel } from "react-icons/md";
import { BsDatabaseFillX } from "react-icons/bs";

const CustomDropdown = ({
  options,
  value,
  setValue,
  placeholder,
  disabled,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Filter options based on input
  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div className={`dropdownWrapper ${disabled ? "disabled" : ""}`}>
      <div className="dropdownInputWrapper">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)} // allow click on option
        />
        {value ? (
          <button
            className="clearBtn"
            type="button"
            onClick={() => setValue("")}
            // onClick={() => {
            //   setValue("");
            //   setTimeout(() => setIsOpen(true), 50);
            // }}
          >
            <MdCancel className="dropIcon" />
          </button>
        ) : (
          <span className="arrow">
            <IoIosSearch className="dropIcon" />
          </span>
        )}
      </div>

      {isOpen && (
        <ul className="dropdownList">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, i) => (
              <li
                key={i}
                onMouseDown={() => setValue(opt)} // use onMouseDown to avoid blur before click
              >
                {opt}
              </li>
            ))
          ) : (
            <div className="noEntry">
              <BsDatabaseFillX className="noEntryIcon" />
              <span>No Data</span>
            </div>
          )}
        </ul>
      )}
    </div>
  );
};

export default CustomDropdown;
