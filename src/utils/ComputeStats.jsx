export function computeStats(data = [], filters = {}) {
  if (!Array.isArray(data)) return {};

  const { state, lga, category, block } = filters;

  // --- APPLY FILTERS FIRST ---
  let filteredData = data;

  if (state)
    filteredData = filteredData.filter(
      (row) => row["state_and_lga/state"] === state
    );
  if (lga)
    filteredData = filteredData.filter(
      (row) => row["state_and_lga/lga"] === lga
    );
  if (category && category.length > 0)
    filteredData = filteredData.filter((row) =>
      category.includes(row["category_of_fbo/fbo_category"])
    );
  if (block && block.length > 0)
    filteredData = filteredData.filter((row) =>
      block.includes(row["category_of_fbo/fbo_block"])
    );

  const total = filteredData.length;

  const totalFacilities = filteredData.filter(
    (row) => row["category_of_fbo/fbo_category"] === "Facility"
  ).length;

  const totalNonFacilities = filteredData.filter(
    (row) => row["category_of_fbo/fbo_category"] === "Non-Facility"
  ).length;

  const christianFBOs = filteredData.filter(
    (row) => row["category_of_fbo/fbo_block"] === "Christian"
  ).length;

  const muslimFBOs = filteredData.filter(
    (row) => row["category_of_fbo/fbo_block"] === "Muslim"
  ).length;

  const interfaithFBOs = filteredData.filter(
    (row) => row["category_of_fbo/fbo_block"] === "Inter-Faith"
  ).length;

  const stateCount = new Set(
    filteredData.map((row) => row["state_and_lga/state"])
  ).size;

  return {
    total,
    totalFacilities,
    totalNonFacilities,
    christianFBOs,
    muslimFBOs,
    interfaithFBOs,
    stateCount,
  };
}
