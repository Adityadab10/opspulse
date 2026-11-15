const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardDateRangeError extends Error {
  constructor(message) {
    super(message);
    this.code = "INVALID_DASHBOARD_DATE_RANGE";
  }
}

const asDateOnly = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
    throw new DashboardDateRangeError(`${label} must use YYYY-MM-DD format`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new DashboardDateRangeError(`${label} must be a valid calendar date`);
  }
  return date;
};

export const getDashboardDateRange = ({ start, end } = {}) => {
  const startDate = asDateOnly(start, "start");
  const endDate = asDateOnly(end, "end");
  if (startDate && endDate && startDate > endDate) {
    throw new DashboardDateRangeError("start must be on or before end");
  }

  return {
    startDate,
    endDateExclusive: endDate ? new Date(endDate.getTime() + 24 * 60 * 60 * 1000) : null,
    start: startDate?.toISOString().slice(0, 10) || null,
    end: endDate?.toISOString().slice(0, 10) || null,
  };
};

export const filterSalesByDateRange = (sales, { startDate, endDateExclusive } = {}) =>
  (Array.isArray(sales) ? sales : []).filter((sale) => {
    const saleDate = new Date(sale.sale_date);
    if (Number.isNaN(saleDate.getTime())) return false;
    return (!startDate || saleDate >= startDate)
      && (!endDateExclusive || saleDate < endDateExclusive);
  });

export const summarizeSales = (sales) => {
  const records = Array.isArray(sales) ? sales : [];
  return {
    totalSalesVolume: records.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0),
    transactionCount: records.length,
  };
};

export const buildMonthlySalesSeries = (sales) => {
  const quantitiesByMonth = new Map();
  for (const sale of Array.isArray(sales) ? sales : []) {
    const saleDate = new Date(sale.sale_date);
    if (Number.isNaN(saleDate.getTime())) continue;
    const month = `${saleDate.getUTCFullYear()}-${String(saleDate.getUTCMonth() + 1).padStart(2, "0")}`;
    quantitiesByMonth.set(month, (quantitiesByMonth.get(month) || 0) + Number(sale.quantity || 0));
  }

  return [...quantitiesByMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, quantity]) => ({ month, quantity }));
};
