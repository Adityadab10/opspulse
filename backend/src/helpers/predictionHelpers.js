export const roundTo = (value, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

export const getMonthlySeries = (salesDocs) => {
  const map = new Map();

  for (const doc of salesDocs) {
    const d = new Date(doc.date);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;

    map.set(key, {
      year,
      month,
      total: (map.get(key)?.total || 0) + Number(doc.quantity || 0),
    });
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.year, a.month, 1) - new Date(b.year, b.month, 1)
  );
};

export const detectSeasonTag = (monthIndex) => {
  const month = monthIndex + 1;

  if (month >= 3 && month <= 5) return "Wedding Season";
  if (month >= 10 && month <= 12) return "Festival Season";
  return "Normal";
};

export const stdDev = (values) => {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};