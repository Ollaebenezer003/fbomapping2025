export const dataVariables = (facility) => {
  const category =
    facility["category_of_fbo/fbo_category"] === "Facility"
      ? "Facility"
      : "Organisation";

  const name =
    facility["fbo_details/name_of_facility"] ||
    facility["fbo_details_non/name_of_organisation"];

  const email =
    facility["fbo_details/head_of_facility_email"] ||
    facility["fbo_details_non/head_of_organisation_email"] ||
    "NA";

  const phone =
    facility["fbo_details/head_of_facility_phone_number"] ||
    facility["fbo_details_non/head_of_organisation_phone_number"] ||
    "NA";

  const headName =
    facility["fbo_details/name_of_facility_head"] ||
    facility["fbo_details_non/name_of_organisation_head"] ||
    "NA";

  const address =
    facility["fbo_details/facility_address"] ||
    facility["fbo_details_non/organisation_address"] ||
    "NA";

  const focalPerson =
    facility["fbo_details/name_of_facility_focal_person"] ||
    facility["fbo_details_non/name_of_organisation_focal_person"] ||
    "NA";

  const fundSource =
    facility["facility_service_delivery/facility_funding_source"] ||
    facility["organisation_service_delivery/organisation_funding_source"] ||
    "NA";

  const orgBody =
    facility["fbo_details/what_organisation_does_the_facility_belong_to"] ||
    facility["fbo_details_non/what_organisation_does_the_org_belong_to"];

  const orgBodyOther =
    facility["fbo_details/other_fbo_organisation"] ||
    facility["fbo_details_non/other_fbo_organisation_001"];

  const hivServices =
    facility["facility_service_delivery/hiv_related_services_rendered"] ||
    facility[
      "organisation_service_delivery/hiv_related_services_rendered_non_facility"
    ] ||
    "NA";

  const serviceDelivery =
    facility["facility_service_delivery/service_delivery_points"] ||
    facility[
      "organisation_service_delivery/service_delivery_points_non_facility"
    ] ||
    "NA";

  const otherServiceDelivery =
    facility["facility_service_delivery/if_yes_other_services_rendered"] ||
    facility[
      "organisation_service_delivery/other_service_delivery_points_non_facility"
    ] ||
    "NA";

  const peopleOnARV =
    facility[
      "facility_service_delivery/what_is_the_total_number_of_people_currently_on_arv"
    ] ||
    facility[
      "organisation_service_delivery/what_is_the_total_number_of_people_currently_on_arv_non_facility"
    ] ||
    "NA";

  const reportHIV =
    facility["data_reporting_mechanism/do_you_report_data_on_hiv_services"] ||
    facility[
      "data_reporting_mechanism_organisation/do_you_report_data_on_hiv_services_organisation"
    ] ||
    "NA";

  const reportLine =
    facility["data_reporting_mechanism/who_do_you_report_to"] ||
    facility[
      "data_reporting_mechanism_organisation/who_do_you_report_to_organisation"
    ] ||
    "NA";

  const personnel =
    facility[
      "human_resource_for_health/which_of_the_following_personnel_are_available_at_the_facility"
    ] ||
    facility[
      "human_resource_for_health_organisation/which_of_the_following_personnel_are_available_at_the_organisation"
    ];

  const bedSpaces =
    facility["facility_resource_utilisation/total_number_of_bed_spaces"] ||
    "NA";

  const wards =
    facility["facility_resource_utilisation/total_number_of_wards"] || "NA";

  const theatres =
    facility["facility_resource_utilisation/total_number_of_theatre"] || "NA";

  const linked =
    facility[
      "data_reporting_mechanism/is_the_facility_linked_with_any_facility"
    ] ||
    facility[
      "data_reporting_mechanism_organisation/is_the_organisation_linked_with_any_facility"
    ];

  const linkedWith =
    facility["data_reporting_mechanism/select_linked_with_any_facility"] ||
    facility[
      "data_reporting_mechanism_organisation/select_linked_with_any_facility_for_organisation"
    ] ||
    "NA";

  const primaryLink =
    facility[
      "data_reporting_mechanism_organisation/enter_the_primary_facility_the_organisation_is_linked_with"
    ] || "NA";

  // Documentation Tools
  const f1 =
    facility[
      "facility_resource_utilisation/what_documentation_tools_do_they_make_use_of_facility"
    ] || "";
  const f2 =
    facility[
      "facility_resource_utilisation/other_documentation_tool_facility"
    ] || "";
  const n1 =
    facility[
      "organisation_resource_utilisation/what_documentation_tools_do_they_make_use_of_non_facility"
    ] || "";
  const n2 =
    facility[
      "organisation_resource_utilisation/other_documentation_tool_non_facility"
    ] || "";

  const facilityDocs = [f1, f2].filter(Boolean).join(", ");
  const nonFacilityDocs = [n1, n2].filter(Boolean).join(", ");
  const documentTools = facilityDocs || nonFacilityDocs || "NA";

  // List of all human resource fields
  const hrFields = [
    "human_resource_for_health/total_number_of_doctors",
    "human_resource_for_health/total_number_of_nurses_or_midwives",
    "human_resource_for_health/total_number_of_pharmcists",
    "human_resource_for_health/total_number_of_community_health_extension_workers",
    "human_resource_for_health/total_number_of_junior_community_health_extension_workers",
    "human_resource_for_health/total_number_of_lab_scientists",
    "human_resource_for_health/total_number_of_lab_technicians",
    "human_resource_for_health/total_number_of_pharmacy_technicians",
    "human_resource_for_health/total_number_of_physiotherapist",
    "human_resource_for_health/total_number_of_biomedical_engineers",
    "human_resource_for_health/total_number_of_dentists",
    "human_resource_for_health/total_number_of_opticians",
    "human_resource_for_health/total_number_of_data_clerk",
    "human_resource_for_health/total_number_of_community_health_officers",
    "human_resource_for_health/total_number_of_social_workers",
    "human_resource_for_health/total_number_of_religious_leaders",
    "human_resource_for_health/total_number_of_radiographers",
    "human_resource_for_health/total_number_of_monitoring_and_evaluation_officers",
    "human_resource_for_health/total_number_of_security_officers",
    "human_resource_for_health/total_number_of_volunteers",
    "human_resource_for_health_organisation/total_number_of_doctors_organisation",
    "human_resource_for_health_organisation/total_number_of_nurses_or_midwives_organisation",
    "human_resource_for_health_organisation/total_number_of_pharmcists_organisation",
    "human_resource_for_health_organisation/total_number_of_community_health_extension_workers_organisation",
    "human_resource_for_health_organisation/total_number_of_junior_community_health_extension_workers_organisation",
    "human_resource_for_health_organisation/total_number_of_lab_scientists_organisation",
    "human_resource_for_health_organisation/total_number_of_lab_technicians_organisation",
    "human_resource_for_health_organisation/total_number_of_pharmacy_technicians_organisation",
    "human_resource_for_health_organisation/total_number_of_physiotherapist_organisation",
    "human_resource_for_health_organisation/total_number_of_biomedical_engineers_organisation",
    "human_resource_for_health_organisation/total_number_of_dentists_organisation",
    "human_resource_for_health_organisation/total_number_of_opticians_organisation",
    "human_resource_for_health_organisation/total_number_of_data_clerk_organisation",
    "human_resource_for_health_organisation/total_number_of_community_health_officers_organisation",
    "human_resource_for_health_organisation/total_number_of_social_workers_organisation",
    "human_resource_for_health_organisation/total_number_of_religious_leaders_organisation",
    "human_resource_for_health_organisation/total_number_of_radiographers_organisation",
    "human_resource_for_health_organisation/total_number_of_monitoring_and_evaluation_officers_organisation",
    "human_resource_for_health_organisation/total_number_of_security_officers_organisation",
    "human_resource_for_health_organisation/total_number_of_volunteers_organisation",
  ];

  // Sum up all personnel counts safely (treat missing/NaN as 0)
  const personnelCount = hrFields.reduce((total, field) => {
    const value = Number(facility[field]) || 0;
    return total + value;
  }, 0);

  // Return all variables as an object
  return {
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
  };
};
