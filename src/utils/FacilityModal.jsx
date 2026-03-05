import { X } from "lucide-react";
import { CiGlobe } from "react-icons/ci";
import { FaHospital } from "react-icons/fa";
import { NavLink } from "react-router-dom";
import { dataVariables } from "./DataVariables";
// import ImagePreview from "./ImagePreview";
import ImageSection from "./ImageSection";

export default function FacilityModal({ open, onClose, facility }) {
  if (!open || !facility) return null;

  function toProperCase(str) {
    if (!str) return ""; // handle null, undefined, empty

    return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }

  // Destructure all variables at once
  const {
    category,
    name,
    email,
    phone,
    headName,
    address,
    focalPerson,
    fundSource,
    orgBody,
    orgBodyOther,
    hivServices,
    serviceDelivery,
    otherServiceDelivery,
    peopleOnARV,
    reportHIV,
    reportLine,
    documentTools,
    personnel,
    personnelCount,
    bedSpaces,
    wards,
    theatres,
    linked,
    linkedWith,
    primaryLink,
  } = dataVariables(facility);

  return (
    <div className="modalOverlay">
      <div className="modalContainer">
        <div className="modalHeaderSection">
          <div className="modalHeaderContent">
            <div className="modalHeader">
              <div className="modalTitle">
                {facility["fbo_details/name_of_facility"] ||
                  facility["fbo_details_non/name_of_organisation"]}
              </div>

              <button className="closeBtn" onClick={onClose}>
                <X className="closeIcon" />
              </button>
            </div>
            <hr className="modalHeadRule" />
          </div>
        </div>

        <div className="modalFacilityLocationSection">
          <div className="modalFacilityLocation">
            <CiGlobe className="locationIcons" />
            <span>State:</span> {facility["state_and_lga/state"]}
          </div>

          <div className="modalFacilityLocation">
            <CiGlobe className="locationIcons" />
            <span>LGA:</span> {facility["state_and_lga/lga"]}
          </div>

          <div className="modalFacilityLocation">
            <FaHospital className="locationIcons" />
            <span>Category:</span> {facility["category_of_fbo/fbo_category"]}
          </div>

          <div className="modalFacilityLocation">
            <FaHospital className="locationIcons" />
            <span>Block:</span> {facility["category_of_fbo/fbo_block"]}
          </div>

          <div className="modalFacilityLocation">
            <FaHospital className="locationIcons" />
            <span>Name:</span>
            {name}
          </div>
        </div>

        <section className="modalSection">
          <div className="modalSectionLeft">
            <p>
              <strong>Head of {category}:</strong> {toProperCase(headName)}
            </p>
            <p>
              <strong>Head of {category}'s Phone Number:</strong>{" "}
              {phone ? <NavLink to={`mailto:${phone}`}>{phone}</NavLink> : "NA"}
            </p>
            <p>
              <strong>Head of {category}'s Email:</strong>{" "}
              {email ? <NavLink to={`mailto:${email}`}>{email}</NavLink> : "NA"}
            </p>
            <p>
              <strong>{category}'s Address:</strong> {toProperCase(address)}
            </p>
          </div>

          <div className="modalSectionRight">
            <p>
              <strong>{category}'s Focal Person:</strong>{" "}
              {toProperCase(focalPerson)}
            </p>
            <p>
              <strong>What Organisation Does it Belong To:</strong> {orgBody}
            </p>

            {orgBody === "Other organisation" ? (
              <p>
                <strong>What Organisation Does it Belong To (Other):</strong>{" "}
                {toProperCase(orgBodyOther)}
              </p>
            ) : (
              ""
            )}
          </div>
        </section>

        <section className="modalSection"></section>

        {/* {facility._attachments?.length > 0 && (
          <section className="modalImageSection">
            <ImagePreview
              src={`http://localhost:8080/media?url=${encodeURIComponent(
                facility._attachments[0].download_small_url
              )}`}
              alt={name}
              className="modalImage"
            />

            <ImagePreview
              src={`http://localhost:8080/media?url=${encodeURIComponent(
                facility._attachments[0].download_medium_url
              )}`}
              alt={name}
              className="modalImage"
            />

            <ImagePreview
              src={`http://localhost:8080/media?url=${encodeURIComponent(
                facility._attachments[0].download_large_url
              )}`}
              alt={name}
              className="modalImage"
            />
          </section>
        )} */}
        {facility._attachments?.length > 0 && (
          <ImageSection attachments={facility._attachments} name={name} />
        )}

        <section className="modalSection"></section>

        <section className="modalTableSection">
          <div className="modalSectionLeft">
            <div className="tableContainer">
              <div className="tableHeader">{category}'s Services</div>

              <div className="tableBody">
                <div className="tableRow">
                  <div className="col">{category} Funding Source</div>
                  <div className="col">{toProperCase(fundSource)}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} HIV-related services</div>
                  <div className="col">{hivServices}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Service delivery points</div>
                  <div className="col">{serviceDelivery}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Other services rendered</div>
                  <div className="col">{otherServiceDelivery}</div>
                </div>

                <div className="tableRow">
                  <div className="col">
                    {category} Total no. of people on ARV
                  </div>
                  <div className="col">{peopleOnARV}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Report on HIV service</div>
                  <div className="col">{reportHIV}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Reporting line</div>
                  <div className="col">{reportLine}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Documentation tools</div>
                  <div className="col">{documentTools}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="modalSectionRight">
            <div className="tableContainer">
              <div className="tableHeader">{category}'s Infrastructure</div>

              <div className="tableBody">
                <div className="tableRow">
                  <div className="col">{category} Personnel</div>
                  <div className="col">{personnel}</div>
                </div>

                <div className="tableRow">
                  <div className="col">
                    {category} Total number of personnel
                  </div>
                  <div className="col">{personnelCount}</div>
                </div>

                <div className="tableRow">
                  <div className="col">
                    {category} Total number of bed spaces
                  </div>
                  <div className="col">{bedSpaces}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Total number of wards</div>
                  <div className="col">{wards}</div>
                </div>

                <div className="tableRow">
                  <div className="col">{category} Total number of theatre</div>
                  <div className="col">{theatres}</div>
                </div>

                <div className="tableRow">
                  <div className="col">
                    {category} Linked with other facility?
                  </div>
                  <div className="col">{linked}</div>
                </div>

                <div className="tableRow">
                  <div className="col">Linked facility type</div>
                  <div className="col">{linkedWith}</div>
                </div>

                {category === "Organisation" ? (
                  <div className="tableRow">
                    <div className="col">
                      {category} primary linked facility
                    </div>
                    <div className="col">{primaryLink}</div>
                  </div>
                ) : (
                  ""
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
