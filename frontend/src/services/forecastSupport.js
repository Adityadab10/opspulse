export const buildForecastSeries = (historical = [], forecast = []) => [
  ...(Array.isArray(historical) ? historical.map((point) => ({
    date: point.date,
    historical: Number(point.quantity || 0),
    forecast: null,
  })) : []),
  ...(Array.isArray(forecast) ? forecast.map((point) => ({
    date: point.date,
    historical: null,
    forecast: Number(point.value || 0),
  })) : []),
];

export const validateForecastOptions = ({ productId, horizon }) => {
  const errors = {};
  if (!productId) errors.productId = "Product is required";
  const numeric = Number(horizon);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 90) errors.horizon = "Horizon must be a whole number from 1 to 90 days";
  return errors;
};
