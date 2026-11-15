export const getInventoryStateMessage = ({ loading, error, productCount }) => {
  if (loading) return "Loading inventory intelligence…";
  if (error) return error;
  if (!productCount) return "No products are available for this tenant.";
  return "Inventory intelligence loaded.";
};
