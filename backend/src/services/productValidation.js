const PRODUCT_LIMITS = {
  name: 255,
  category: 100,
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
  return errors;
};

export const normalizeProductInput = (input = {}) => ({
  name: typeof input.name === "string" ? input.name.trim() : input.name,
  category: typeof input.category === "string" ? input.category.trim() : input.category,
});
