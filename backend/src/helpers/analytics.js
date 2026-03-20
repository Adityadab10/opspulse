export const roundTo = (value, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

export const calculatePercentChange = (current, previous) => {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;

  if (previousValue === 0) {
    return currentValue === 0 ? 0 : 100;
  }

  return ((currentValue - previousValue) / previousValue) * 100;
};

export const getSixMonthStartDate = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 5, 1);
};