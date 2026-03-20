import Sales from "../models/Sales.js";
import { getMonthlySeries, roundTo, detectSeasonTag, stdDev } from "../helpers/predictionHelpers.js";

const getConfidenceLevel = ({ monthlySeries, trend, hasSameMonthLastYear }) => {
  if (monthlySeries.length < 3) return "Low";

  const values = monthlySeries.map((m) => m.total);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variation = mean === 0 ? 1 : stdDev(values) / mean;

  const consistentGrowth = trend > 0;
  const seasonMatch = hasSameMonthLastYear;

  if (monthlySeries.length >= 6 && variation < 0.35 && (consistentGrowth || seasonMatch)) {
    return "High";
  }

  if (variation < 0.65) return "Medium";
  return "Low";
};

export const generatePredictionForProduct = async (productId) => {
  const salesDocs = await Sales.find({ productId }).sort({ date: 1 }).lean();
  const monthlySeries = getMonthlySeries(salesDocs);

  if (!monthlySeries.length) {
    return {
      predictedDemand: 0,
      avgSales: 0,
      percentChange: 0,
      confidence: "Low",
      seasonTag: "Normal",
    };
  }

  const last = monthlySeries[monthlySeries.length - 1];
  const previous = monthlySeries[monthlySeries.length - 2];

  const lastMonthSales = last?.total || 0;
  const previousMonthSales = previous?.total || 0;
  const trend = lastMonthSales - previousMonthSales;

  const last3 = monthlySeries.slice(-3);
  const last3MonthsAverage =
    last3.reduce((sum, item) => sum + item.total, 0) / (last3.length || 1);

  const nextMonthDate = new Date(last.year, last.month, 1);
  const targetMonth = nextMonthDate.getMonth();
  const targetYear = nextMonthDate.getFullYear();

  const sameMonthLastYearEntry = monthlySeries.find(
    (m) => m.year === targetYear - 1 && m.month === targetMonth
  );
  const sameMonthLastYear = sameMonthLastYearEntry?.total ?? null;

  const seasonalBase = sameMonthLastYear ?? lastMonthSales;

  let predictedDemand =
    0.5 * seasonalBase + 0.3 * last3MonthsAverage + 0.2 * trend;

  predictedDemand = Math.max(0, predictedDemand);

  const avgSales =
    monthlySeries.reduce((sum, item) => sum + item.total, 0) / monthlySeries.length;

  const percentChange =
    avgSales === 0 ? 0 : ((predictedDemand - avgSales) / avgSales) * 100;

  const seasonTag = detectSeasonTag(targetMonth);
  const confidence = getConfidenceLevel({
    monthlySeries,
    trend,
    hasSameMonthLastYear: sameMonthLastYear !== null,
  });

  return {
    predictedDemand: roundTo(predictedDemand),
    avgSales: roundTo(avgSales),
    percentChange: roundTo(percentChange),
    confidence,
    seasonTag,
  };
};