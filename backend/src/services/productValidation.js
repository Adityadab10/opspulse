const PRODUCT_LIMITS = {
  name: 255,
  category: 100,
  reorderThreshold: 1000000000,
};

export const validateProductInput = (input = {}) => {
  const errors = {};
  for (const field of ["name", "category"]) {
    const value = input[field];
    if (typeof value !== "string" || !value.trim()) {
      errors[field] = `${field} is required`;
    } else if (value.trim().length > PRODUCT_LIMITS[field]) {
      errors[field] = `${field} must be ${PRODUCT_LIMITS[field]} characters or fewer`;
    }
  }
  if (input.reorderThreshold !== undefined && input.reorderThreshold !== null) {
    const threshold = Number(input.reorderThreshold);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > PRODUCT_LIMITS.reorderThreshold) {
      errors.reorderThreshold = "reorder threshold must be a non-negative integer";
    }
  }
  return errors;
};

export const normalizeProductInput = (input = {}) => {
  const normalized = {
    name: typeof input.name === "string" ? input.name.trim() : input.name,
    category: typeof input.category === "string" ? input.category.trim() : input.category,
  };
  if (input.reorderThreshold !== undefined && input.reorderThreshold !== "") normalized.reorderThreshold = Number(input.reorderThreshold);
  return normalized;
};
