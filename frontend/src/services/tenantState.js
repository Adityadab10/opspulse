let selectedTenantId = null;
let tenantContextVersion = 0;

export const getSelectedTenantId = () => selectedTenantId;

export const getTenantContextVersion = () => tenantContextVersion;

export const setSelectedTenantId = (tenantId) => {
  const nextTenantId = tenantId || null;
  if (nextTenantId !== selectedTenantId) tenantContextVersion += 1;
  selectedTenantId = nextTenantId;
  return selectedTenantId;
};

export const clearSelectedTenantId = () => {
  selectedTenantId = null;
  tenantContextVersion += 1;
};
