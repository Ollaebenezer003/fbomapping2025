// import { choicesMap } from "./choicesMap.js";

// // Convert a single value (handles multi-select and single-select)
// function convertValue(value) {
//   if (!value || typeof value !== "string") return value;

//   // MULTI-SELECT (space-separated values)
//   if (value.includes(" ")) {
//     return value
//       .split(" ")
//       .map((v) => choicesMap[v] || v.replace(/_/g, " "))
//       .join(", ");
//   }

//   // SINGLE-SELECT
//   return choicesMap[value] || value.replace(/_/g, " ");
// }

// // Convert all fields in a record
// export function mapRecordChoices(record) {
//   const newRecord = { ...record };

//   for (const key in newRecord) {
//     const value = newRecord[key];

//     if (typeof value === "string") {
//       newRecord[key] = convertValue(value);
//     }
//   }

//   return newRecord;
// }

import { choicesMap } from "./choicesMap.js";

// Fields that are multi-select in Kobo (space-separated values)
const multiSelectFields = [
  "facility_service_delivery/facility_funding_source",
  "organisation_service_delivery/organisation_funding_source",
  "facility_service_delivery/hiv_related_services_rendered",
  "organisation_service_delivery/hiv_related_services_rendered_non_facility",
  "facility_service_delivery/service_delivery_points",
  "organisation_service_delivery/service_delivery_points_non_facility",
  "human_resource_for_health/which_of_the_following_personnel_are_available_at_the_facility",
  "human_resource_for_health_organisation/which_of_the_following_personnel_are_available_at_the_organisation",
  "facility_resource_utilisation/what_documentation_tools_do_they_make_use_of_facility",
  "organisation_resource_utilisation/what_documentation_tools_do_they_make_use_of_non_facility",
  "data_reporting_mechanism/who_do_you_report_to",
  "data_reporting_mechanism_organisation/who_do_you_report_to_organisation",
  "data_reporting_mechanism/select_linked_with_any_facility",
  "data_reporting_mechanism_organisation/select_linked_with_any_facility_for_organisation",
  // add more known multi-select fields here
];

// Convert a single value (handles multi-select and single-select)
function convertValue(key, value) {
  if (!value || typeof value !== "string") return value;

  // MULTI-SELECT
  if (multiSelectFields.includes(key)) {
    return value
      .split(" ")
      .map((v) => choicesMap[v] || v.replace(/_/g, " "))
      .join(", ");
  }

  // SINGLE-SELECT
  return choicesMap[value] || value.replace(/_/g, " ");
}

// Convert all fields in a record
export function mapRecordChoices(record) {
  const newRecord = { ...record };

  for (const key in newRecord) {
    const value = newRecord[key];

    if (typeof value === "string") {
      newRecord[key] = convertValue(key, value);
    }
  }

  return newRecord;
}
