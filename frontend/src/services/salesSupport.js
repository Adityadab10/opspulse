export const validateSaleInput = ({ productId, date, quantity }) => {
  const errors = {};
  if (!productId) errors.productId = "Product is required";
  if (!date) errors.date = "Date and time are required";
  const numericQuantity = Number(quantity);
  if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
    errors.quantity = "Quantity must be a positive whole number";
  }
  return errors;
};
