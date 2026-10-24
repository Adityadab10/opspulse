import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BrainCircuit,
  CircleAlert,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import KPIcard from "../components/KPIcard";
import LineChart from "../components/LineChart";
import DonutChart from "../components/DonutChart";
import ProductTable from "../components/ProductTable";
import NewsPanel from "../components/NewsPanel";
import AlertList from "../components/AlertList";
import ComparisonModal from "../components/ComparisonModal";
import ForecastComparisonChart from "../components/ForecastComparisonChart";
import AiAnalystPanel from "../components/AiAnalystPanel";
import { alertsApi, comparisonApi, dashboardApi, newsApi, predictionApi, productsApi } from "../services/api";

const mergeAnalysisWithProducts = (analysisRows, products) => {
  const bucket = new Map();

  products.forEach((product) => {
    const key = `${product?.name || ""}::${product?.category || ""}`;
    if (!bucket.has(key)) {
      bucket.set(key, []);
    }
    bucket.get(key).push(product);
  });

  return analysisRows.map((row) => {
    const key = `${row?.name || ""}::${row?.category || ""}`;
    const candidate = bucket.get(key)?.shift();
    const existingRowId =
      row?.productId?._id ||
      row?.productId ||
      row?._id ||
      row?.id ||
      null;

    return {
      ...row,
      productId: existingRowId || candidate?._id || null,
    };
  });
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
};

const normalizePredictionPayload = (payload, fallbackProductId) => {
  const response = payload?.data || payload || {};
  const normalizedFactors = Array.isArray(response?.contributingFactors)
    ? response.contributingFactors
    : [];

  return {
    productId:
      typeof response.productId === "object" && response.productId !== null
        ? response.productId
        : {
            _id: response.productId || fallbackProductId,
            name: response?.productId?.name,
            category: response?.productId?.category,
          },
    rulePrediction: response.rulePrediction ?? response.predictedDemand ?? 0,
    mlPrediction: response.mlPrediction ?? response.forecast ?? response.predictedDemand ?? 0,
    adjustedPrediction:
      response.adjustedPrediction ??
      response.adjustedForecast ??
      response.predictedDemand ??
      0,
    decision: response.decision ?? "maintain",
    impact: response.impact ?? "neutral",
    confidence: response.confidence ?? null,
    keyword: response.keyword ?? null,
    score: toNumber(response.score, 0),
    sourceHeadline: response.sourceHeadline ?? null,
    sourceHeadlines: Array.isArray(response.sourceHeadlines) ? response.sourceHeadlines : [],
    matchedKeywords: Array.isArray(response.keywords)
      ? response.keywords
      : Array.isArray(response.matchedKeywords)
        ? response.matchedKeywords
        : [],
    reason: response.reason ?? "No explanation available.",
    contributingFactors: normalizedFactors,
    predictionSource: response.predictionSource ?? "rule-based",
    predictedAt: response.predictedAt ?? null,
  };
};

const extractPredictionRows = (rawResponseData) => {
  const payload = rawResponseData?.data ?? rawResponseData ?? {};

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.predictions)
      ? payload.predictions
      : [];

  return rows.map((row) =>
    normalizePredictionPayload(
      row,
      row?.productId?._id || row?.productId || null
    )
  );
};

const normalizeComparisonRow = (row) => {
  const prophetPrediction = row?.prophetPrediction ?? row?.prophet_prediction;
  const arimaPrediction = row?.arimaPrediction ?? row?.arima_prediction;
  const actualValues = row?.actualValues ?? row?.actual_values;

  return {
    productId:
      row?.productId?._id || row?.productId || row?._id || row?.id || null,
    productName: row?.productName || row?.productId?.name || row?.name || "Unknown Product",
    category: row?.category || row?.productId?.category || "Uncategorized",
    prophetPrediction: toArray(prophetPrediction),
    arimaPrediction: toArray(arimaPrediction),
    actualValues: toArray(actualValues),
    prophetRMSE: toNumber(row?.prophetRMSE ?? row?.prophet_rmse, 0),
    arimaRMSE: toNumber(row?.arimaRMSE ?? row?.arima_rmse, 0),
    prophetMAE: toNumber(row?.prophetMAE ?? row?.prophet_mae, 0),
    arimaMAE: toNumber(row?.arimaMAE ?? row?.arima_mae, 0),
    prophetMAPE: toNumber(row?.prophetMAPE ?? row?.prophet_mape, 0),
    arimaMAPE: toNumber(row?.arimaMAPE ?? row?.arima_mape, 0),
    betterModel: row?.betterModel || row?.better_model || "tie",
  };
};

const sumPrediction = (values) =>
  Array.isArray(values)
    ? values.reduce((sum, value) => sum + toNumber(value, 0), 0)
    : toNumber(values, 0);

const getBetterModelBadgeClass = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "prophet") {
    return "bg-blue-500/20 text-blue-200 border border-blue-500/30";
  }
  if (normalized === "arima") {
    return "bg-purple-500/20 text-purple-200 border border-purple-500/30";
  }
  return "bg-slate-500/20 text-slate-200 border border-slate-500/30";
};

const formatModelLabel = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "prophet") return "Prophet";
  if (normalized === "arima") return "ARIMA";
  return "Tie";
};

const getDecisionBadgeClass = (decision) => {
  const normalized = String(decision || "").toLowerCase();
  if (normalized === "increase") {
    return "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30";
  }
  if (normalized === "reduce") {
    return "bg-rose-500/20 text-rose-200 border border-rose-500/30";
  }
  return "bg-amber-500/20 text-amber-200 border border-amber-500/30";
};

const getImpactBadgeClass = (impact) => {
  const normalized = String(impact || "").toLowerCase();
  if (normalized === "increase") {
    return "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30";
  }
  if (normalized === "decrease") {
    return "bg-rose-500/20 text-rose-200 border border-rose-500/30";
  }
  return "bg-slate-500/20 text-slate-200 border border-slate-500/30";
};

const formatDecision = (decision) => {
  const normalized = String(decision || "").toLowerCase();
  if (!normalized) return "Maintain";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatImpact = (impact) => {
  const normalized = String(impact || "").toLowerCase();
  if (!normalized) return "Neutral";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatConfidence = (confidence) => {
  if (typeof confidence === "string") {
    return confidence;
  }

  const numeric = Number(confidence);
  if (!Number.isFinite(numeric)) {
    return "N/A";
  }

  return `${(numeric * 100).toFixed(1)}%`;
};

const humanizeFactorKey = (key) => {
  const raw = String(key || "factor").trim();
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
};

const formatFactorValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value == null) {
    return "N/A";
  }
  return String(value);
};

const formatReasonSummary = (reason) => {
  const text = String(reason || "").trim();
  if (!text) {
    return "No explanation available.";
  }

  const becauseIndex = text.toLowerCase().indexOf(" because ");
  if (becauseIndex === -1) {
    return text;
  }

  return text.slice(0, becauseIndex).trim();
};

export default function Dashboard() {
  const [summary, setSummary] = useState({
    totalProducts: 0,
    avgMonthlySales: 0,
    activeAlerts: 0,
    recommendationsReady: 0,
  });
  const [analysis, setAnalysis] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [comparisonData, setComparisonData] = useState([]);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [comparisonError, setComparisonError] = useState("");
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);
  const [selectedComparison, setSelectedComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [predictionsLoading, setPredictionsLoading] = useState(true);
  const [predictionsError, setPredictionsError] = useState("");
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [runAllError, setRunAllError] = useState("");
  const [lastPredictionsSyncAt, setLastPredictionsSyncAt] = useState(null);
  const [predictionLoadingById, setPredictionLoadingById] = useState({});
  const [predictionResultsById, setPredictionResultsById] = useState({});
  const [predictionErrorById, setPredictionErrorById] = useState({});
  const [newsLoadingById, setNewsLoadingById] = useState({});
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [newsPanelLoading, setNewsPanelLoading] = useState(false);
  const [newsPanelError, setNewsPanelError] = useState("");
  const [newsPanelData, setNewsPanelData] = useState(null);
  const [newsPanelProduct, setNewsPanelProduct] = useState(null);
  const [selectedNewsProductId, setSelectedNewsProductId] = useState("");
  const [productIntelligence, setProductIntelligence] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      setSummaryLoading(true);
      setDashboardError("");

      const [summaryRes, analysisRes, alertsRes, productsRes] = await Promise.all([
        dashboardApi.getSummary(),
        productsApi.getAnalysis(),
        alertsApi.getAlerts(),
        productsApi.getAll(),
      ]);

      const analysisRows = Array.isArray(analysisRes?.data) ? analysisRes.data : [];
      const products = Array.isArray(productsRes?.data) ? productsRes.data : [];
      const mergedAnalysis = mergeAnalysisWithProducts(analysisRows, products);

      setSummary(summaryRes?.data || {});
      setAnalysis(mergedAnalysis);
      setSelectedNewsProductId((prev) => {
        if (prev && mergedAnalysis.some((item) => String(item?.productId || "") === String(prev))) {
          return prev;
        }

        const firstWithId = mergedAnalysis.find((item) => item?.productId);
        return firstWithId?.productId || "";
      });
      setAlerts(Array.isArray(alertsRes?.data) ? alertsRes.data : []);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      const message =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to load dashboard summary data.";
      setDashboardError(message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadPredictions = useCallback(async ({ forceRefresh = false } = {}) => {
    try {
      setPredictionsLoading(true);
      setPredictionsError("");

      const predictionsRes = await predictionApi.getPredictions(
        forceRefresh ? { refresh: 1 } : {}
      );
      const rows = extractPredictionRows(predictionsRes?.data);

      setPredictions(rows);
      setLastPredictionsSyncAt(new Date());
    } catch (err) {
      console.error("Predictions fetch error:", err);

      const message =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to load predictions.";

      setPredictionsError(message);
      setPredictions([]);
    } finally {
      setPredictionsLoading(false);
    }
  }, []);

  const loadComparisons = useCallback(async () => {
    try {
      setComparisonLoading(true);
      setComparisonError("");

      const response = await comparisonApi.getComparisons();
      const rows = Array.isArray(response?.data) ? response.data : [];
      setComparisonData(rows.map(normalizeComparisonRow));
    } catch (err) {
      console.error("Comparison fetch error:", err);

      const message =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to load forecast comparisons.";
      setComparisonError(message);
      setComparisonData([]);
    } finally {
      setComparisonLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await Promise.all([
        loadDashboard(),
        loadPredictions({ forceRefresh: true }),
        loadComparisons(),
      ]);
      setLoading(false);
    };

    bootstrap();
  }, [loadDashboard, loadPredictions, loadComparisons]);

  useEffect(() => {
    if (!comparisonModalOpen) {
      setSelectedComparison(null);
    }
  }, [comparisonModalOpen]);

  const runPrediction = async (productId) => {
    if (!productId) {
      toast.error("Missing product ID for prediction.");
      return;
    }

    setPredictionLoadingById((prev) => ({ ...prev, [productId]: true }));
    setPredictionErrorById((prev) => ({ ...prev, [productId]: "" }));

    try {
      const response = await predictionApi.runPrediction(productId, { refresh: 1 });
      const normalized = normalizePredictionPayload(response?.data?.data || response?.data, productId);

      setPredictionResultsById((prev) => ({ ...prev, [productId]: normalized }));

      setPredictions((prev) => {
        const existingIndex = prev.findIndex((item) => {
          const existingId =
            typeof item?.productId === "object"
              ? item?.productId?._id || item?.productId?.id
              : item?.productId;
          return String(existingId || "") === String(productId);
        });

        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = { ...prev[existingIndex], ...normalized };
          return next;
        }

        return [normalized, ...prev];
      });

      toast.success("Prediction generated successfully");
      setLastPredictionsSyncAt(new Date());
    } catch (error) {
      console.error("Run prediction error:", error);
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to generate prediction.";

      setPredictionErrorById((prev) => ({ ...prev, [productId]: message }));
      toast.error(message);
    } finally {
      setPredictionLoadingById((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const runAllPredictions = async () => {
    try {
      setRunAllLoading(true);
      setRunAllError("");

      const response = await predictionApi.runAllPredictions({ refresh: 1 });
      const payload = response?.data?.data ?? response?.data ?? {};

      const rows = Array.isArray(payload?.predictions)
        ? payload.predictions
        : Array.isArray(payload)
          ? payload
          : [];

      const normalizedRows = rows.map((row) =>
        normalizePredictionPayload(row, row?.productId?._id || row?.productId || null)
      );

      if (normalizedRows.length > 0) {
        setPredictions(normalizedRows);
      } else {
        await loadPredictions({ forceRefresh: true });
      }

      setLastPredictionsSyncAt(new Date());

      const savedCount = toNumber(payload?.saved, normalizedRows.length);
      toast.success(`AI predictions generated for ${savedCount} products.`);
    } catch (error) {
      console.error("Run all predictions error:", error);
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to run all predictions.";
      setRunAllError(message);
      toast.error(message);
    } finally {
      setRunAllLoading(false);
    }
  };

  const openProductNews = async (productInfo) => {
    const productId = productInfo?.productId;
    if (!productId) {
      toast.error("Missing product ID for news lookup.");
      return;
    }

    setNewsPanelOpen(true);
    setNewsPanelLoading(true);
    setNewsPanelError("");
    setNewsPanelData(null);
    setNewsPanelProduct({
      name: productInfo?.name || "Selected product",
      category: productInfo?.category || "",
    });
    setNewsLoadingById((prev) => ({ ...prev, [productId]: true }));

    try {
      const response = await newsApi.getProductNews(productId);
      const payload = response?.data?.data ?? response?.data ?? {};
      const matchingPrediction = predictions.find((row) => {
        const existingId =
          typeof row?.productId === "object"
            ? row?.productId?._id || row?.productId?.id
            : row?.productId;
        return String(existingId || "") === String(productId);
      });

      const panelKeywords = Array.isArray(payload?.keywords)
        ? payload.keywords
        : Array.isArray(payload?.matchedKeywords)
          ? payload.matchedKeywords
          : [];

      setNewsPanelData({
        product: payload?.product || {
          name: productInfo?.name || "Selected product",
          category: productInfo?.category || "",
        },
        headlines: Array.isArray(payload?.headlines) ? payload.headlines : [],
        impact: payload?.impact || "neutral",
        keyword: payload?.keyword || null,
        matchedKeywords: panelKeywords,
        suggestion: payload?.suggestion || "Maintain stock",
        adjustedPrediction: toNumber(
          payload?.adjustedPrediction,
          matchingPrediction?.adjustedPrediction ?? null
        ),
      });
    } catch (error) {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to fetch news";
      setNewsPanelError(message);
    } finally {
      setNewsPanelLoading(false);
      setNewsLoadingById((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const retryNewsPanel = async () => {
    if (!newsPanelProduct?.name) {
      return;
    }

    const rowMatch = analysis.find(
      (row) =>
        String(row?.name || "").toLowerCase() === String(newsPanelProduct?.name || "").toLowerCase() &&
        String(row?.category || "").toLowerCase() === String(newsPanelProduct?.category || "").toLowerCase()
    );

    if (!rowMatch?.productId) {
      setNewsPanelError("Unable to locate product for retry.");
      return;
    }

    await openProductNews({
      productId: rowMatch.productId,
      name: rowMatch.name,
      category: rowMatch.category,
    });
  };

  const openSelectedNewsProduct = async () => {
    const rowMatch = analysis.find(
      (row) => String(row?.productId || "") === String(selectedNewsProductId || "")
    );

    if (!rowMatch?.productId) {
      toast.error("Select a product with a valid ID to view news insights.");
      return;
    }

    await openProductNews({
      productId: rowMatch.productId,
      name: rowMatch.name,
      category: rowMatch.category,
    });
  };

  const decisionCounts = useMemo(
    () =>
      predictions.reduce(
        (acc, item) => {
          const decision = String(item?.decision || "").toLowerCase();
          if (decision === "increase" || decision === "maintain" || decision === "reduce") {
            acc[decision] += 1;
          }
          return acc;
        },
        { increase: 0, maintain: 0, reduce: 0 }
      ),
    [predictions]
  );

  const decisionChartData = [
    { name: "Increase", value: decisionCounts.increase },
    { name: "Maintain", value: decisionCounts.maintain },
    { name: "Reduce", value: decisionCounts.reduce },
  ];

  const topImpactedProducts = useMemo(() => {
    return [...predictions]
      .map((item) => {
        const rule = toNumber(item?.rulePrediction, 0);
        const adjusted = toNumber(item?.adjustedPrediction, rule);
        return {
          ...item,
          delta: adjusted - rule,
          impactScore: Math.abs(adjusted - rule),
        };
      })
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 3);
  }, [predictions]);

  const hasPredictions = predictions.length > 0;
  const comparisonChartData = useMemo(() => {
    return comparisonData.slice(0, 8).map((row) => ({
      name: row.productName || "Product",
      Prophet: Number(sumPrediction(row.prophetPrediction).toFixed(0)),
      ARIMA: Number(sumPrediction(row.arimaPrediction).toFixed(0)),
    }));
  }, [comparisonData]);

  if (loading) {
    return (
      <div className="page-shell flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500/20 border-t-purple-500"></div>
          <p className="text-slate-300">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 space-y-6 p-4 md:p-8">
        {/* Header with gradient */}
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-white via-purple-200 to-purple-400 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 text-slate-400">
            Welcome back! Here's what's happening with your inventory today.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runAllPredictions}
              disabled={runAllLoading || predictionsLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-purple-400/40 bg-purple-500/20 px-4 py-2 text-sm font-semibold text-purple-100 transition hover:bg-purple-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runAllLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Run All Predictions
            </button>

            <button
              type="button"
              onClick={() => loadPredictions({ forceRefresh: true })}
              disabled={predictionsLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-500/40 bg-slate-500/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${predictionsLoading ? "animate-spin" : ""}`} />
              Refresh AI Data
            </button>

            {lastPredictionsSyncAt ? (
              <span className="text-xs text-slate-400">
                Last synced: {lastPredictionsSyncAt.toLocaleTimeString()}
              </span>
            ) : null}
          </div>

          {dashboardError && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <span>{dashboardError}</span>
              <button
                type="button"
                onClick={loadDashboard}
                disabled={summaryLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${summaryLoading ? "animate-spin" : ""}`} />
                Retry
              </button>
            </div>
          )}
          {runAllError && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <span>{runAllError}</span>
              <button
                type="button"
                onClick={runAllPredictions}
                disabled={runAllLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runAllLoading ? "animate-spin" : ""}`} />
                Retry Run All
              </button>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPIcard title="Total Products" value={summary.totalProducts ?? 0} />
          <KPIcard title="Avg Monthly Sales" value={summary.avgMonthlySales ?? 0} />
          <KPIcard title="Active Alerts" value={summary.activeAlerts ?? 0} />
          <KPIcard title="Recommendations Ready" value={summary.recommendationsReady ?? 0} />
        </section>

        <AiAnalystPanel />

        <section id="news-insights" className="glass rounded-2xl p-6 transition-all hover:border-cyan-500/40">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="bg-gradient-to-r from-cyan-100 to-cyan-300 bg-clip-text text-xl font-bold text-transparent">
                News Insights
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Pick a product to fetch headlines and get an AI stock suggestion.
              </p>
            </div>
            <button
              type="button"
              onClick={openSelectedNewsProduct}
              disabled={!selectedNewsProductId}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              View News Insights
            </button>
          </div>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Product
          </label>
          <select
            value={selectedNewsProductId}
            onChange={(event) => setSelectedNewsProductId(event.target.value)}
            className="w-full rounded-xl border border-slate-500/30 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/50"
          >
            {!selectedNewsProductId && <option value="">Select a product</option>}
            {analysis
              .filter((row) => row?.productId)
              .map((row, index) => (
                <option key={`${row.productId}-${index}`} value={row.productId}>
                  {row.name} ({row.category})
                </option>
              ))}
          </select>
        </section>

        {selectedProductId && productIntelligence ? (
          <section className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
                  Product Intelligence
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {productIntelligence.product?.name} · {productIntelligence.product?.category}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProductIntelligence(null);
                  setSelectedProductId("");
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Summary</p>
                <ul className="space-y-2 text-sm text-slate-200">
                  <li>Avg Monthly Sales: {productIntelligence.summary?.avgSales != null ? productIntelligence.summary.avgSales : "N/A"}</li>
                  <li>Recent Sales: {productIntelligence.summary?.recentSales ?? "N/A"}</li>
                  <li>Previous Sales: {productIntelligence.summary?.previousSales ?? "N/A"}</li>
                  <li>Percent Change: {productIntelligence.summary?.percentChange != null ? productIntelligence.summary.percentChange.toFixed(1) + "%" : "N/A"}</li>
                  <li>Trend: {productIntelligence.summary?.trendDirection ?? "N/A"}</li>
                </ul>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Forecast</p>
                <ul className="space-y-2 text-sm text-slate-200">
                  <li>Predicted Demand: {productIntelligence.forecast?.predictedDemand ?? "N/A"}</li>
                  <li>Rule Prediction: {productIntelligence.forecast?.rulePrediction ?? "N/A"}</li>
                  <li>ML Prediction: {productIntelligence.forecast?.mlPrediction ?? "N/A"}</li>
                  <li>Adjusted Prediction: {productIntelligence.forecast?.adjustedPrediction ?? "N/A"}</li>
                  <li>Confidence: {productIntelligence.forecast?.confidence ?? "N/A"}</li>
                  <li>Source: {productIntelligence.forecast?.predictionSource ?? "N/A"}</li>
                </ul>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Why this prediction?</p>
                <ul className="space-y-2 text-xs text-slate-200">
                  <li>Historical demand: {productIntelligence.forecast?.reason?.match(/Historical demand: (.+?)\./)?.[1] ?? "Demand trend analyzed"}</li>
                  <li>Forecast: {productIntelligence.forecast?.predictedDemand != null ? `${productIntelligence.forecast.predictedDemand}` : "units predicted"}</li>
                  <li>Trend: {productIntelligence.summary?.trendDirection ?? "stable"}</li>
                  <li>Seasonality: {productIntelligence.forecast?.seasonTag ?? "Normal"}</li>
                  <li>External signal: {productIntelligence.forecast?.keyword ?? "none"}</li>
                  <li>Confidence: {productIntelligence.forecast?.confidence ?? "Low"}</li>
                  <li>Final decision: {productIntelligence.forecast?.decision ?? "maintain"}</li>
                </ul>
              </div>
            </div>
            {productIntelligence.alerts && productIntelligence.alerts.length > 0 && (
              <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <p className="text-xs uppercase tracking-wide text-purple-200">Active Alerts</p>
                <ul className="space-y-1 text-xs text-purple-100">
                  {productIntelligence.alerts.map((alert, idx) => (
                    <li key={idx}>
                      <span className="font-semibold">
                        {alert.type}: {alert.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : null}

        {/* Charts Section */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LineChart predictions={predictions} />
          </div>
          {predictionsLoading ? (
            <div className="glass flex h-[26rem] items-center justify-center rounded-2xl p-6">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-500/20 border-t-purple-500"></div>
                <p className="text-sm text-slate-300">Loading predictions...</p>
              </div>
            </div>
          ) : predictionsError ? (
            <div className="glass flex h-[26rem] items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center text-red-200">
              {predictionsError}
            </div>
          ) : !hasPredictions ? (
            <div className="glass flex h-[26rem] items-center justify-center rounded-2xl p-6 text-center text-slate-300">
              <div className="space-y-3">
                <p>No predictions available</p>
                <button
                  type="button"
                  onClick={() => loadPredictions({ forceRefresh: true })}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-500/20"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <DonutChart data={decisionChartData} />
          )}
        </section>

        <section className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-300" />
            <h3 className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
              AI Insights
            </h3>
          </div>

          {predictionsLoading ? (
            <div className="py-8 text-center text-slate-300">Generating insights...</div>
          ) : predictionsError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <div className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>
                  <p>{predictionsError}</p>
                  <button
                    type="button"
                    onClick={() => loadPredictions({ forceRefresh: true })}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry Insights
                  </button>
                </div>
              </div>
            </div>
          ) : topImpactedProducts.length > 0 ? (
            <div className="space-y-4">
              {topImpactedProducts.map((item, index) => {
                const isPositiveDelta = item.delta > 0;
                const DeltaIcon = isPositiveDelta ? TrendingUp : TrendingDown;

                return (
                  <div
                    key={`${item?.productId?._id || item?.productId?.name || "product"}-${index}`}
                    className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-white">
                        {item?.productId?.name || "Unknown Product"}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${getDecisionBadgeClass(
                          item?.decision
                        )}`}
                      >
                        <BrainCircuit className="h-3.5 w-3.5" />
                        {formatDecision(item?.decision)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${getImpactBadgeClass(
                          item?.impact
                        )}`}
                      >
                        <DeltaIcon className="h-3.5 w-3.5" />
                        {formatImpact(item?.impact)}
                      </span>
                      <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 font-semibold text-indigo-100">
                        Delta: {item.delta > 0 ? "+" : ""}{toNumber(item.delta, 0).toFixed(1)}
                      </span>
                      <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2.5 py-1 font-semibold text-slate-200">
                        Confidence: {formatConfidence(item?.confidence)}
                      </span>
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-100">
                        News Score: {toNumber(item?.score, 0).toFixed(1)}
                      </span>
                      {item?.keyword ? (
                        <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 font-semibold text-purple-100">
                          Keyword: {item.keyword}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-3 text-sm text-slate-200">
                      {formatReasonSummary(item?.reason)}
                    </p>
                    {item?.sourceHeadline ? (
                      <p className="mt-2 text-xs text-slate-400">
                        Source: {item.sourceHeadline}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Run predictions to see top impacted products and AI-driven recommendations.
            </p>
          )}
        </section>

        <section className="glass rounded-2xl p-6 transition-all hover:border-blue-500/40">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="bg-gradient-to-r from-white to-blue-200 bg-clip-text text-xl font-bold text-transparent">
                Forecast Model Comparison
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Compare Prophet and ARIMA forecasts for every product and view accuracy metrics.
              </p>
            </div>
            <button
              type="button"
              onClick={loadComparisons}
              disabled={comparisonLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${comparisonLoading ? "animate-spin" : ""}`} />
              Refresh Comparison
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ForecastComparisonChart data={comparisonChartData} />
            </div>
            <div className="glass rounded-2xl p-6">
              <h4 className="text-sm font-semibold text-slate-200">Quick Accuracy Snapshot</h4>
              <p className="mt-2 text-sm text-slate-400">
                Lower RMSE/MAE indicates a closer fit to recent sales data. Use the
                comparison table to review the best model per product.
              </p>
              <div className="mt-4 space-y-2 text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Products compared</span>
                  <span className="font-semibold text-white">{comparisonData.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Prophet wins</span>
                  <span className="font-semibold text-white">
                    {comparisonData.filter((row) => String(row.betterModel).toLowerCase() === "prophet").length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>ARIMA wins</span>
                  <span className="font-semibold text-white">
                    {comparisonData.filter((row) => String(row.betterModel).toLowerCase() === "arima").length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {comparisonLoading ? (
            <div className="mt-6 flex items-center justify-center rounded-xl border border-slate-500/30 bg-slate-900/60 px-4 py-6 text-sm text-slate-300">
              Loading comparison data...
            </div>
          ) : comparisonError ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <span>{comparisonError}</span>
              <button
                type="button"
                onClick={loadComparisons}
                className="inline-flex items-center gap-1 rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          ) : comparisonData.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-blue-500/20">
                  <tr>
                    <th className="px-4 py-4 font-semibold text-slate-300">Product Name</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Prophet Prediction</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">ARIMA Prediction</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Prophet RMSE</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">ARIMA RMSE</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Better Model</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row, index) => (
                    <tr
                      key={`${row.productId || row.productName}-${index}`}
                      className="border-b border-blue-500/10 transition-colors hover:bg-blue-500/5"
                    >
                      <td className="px-4 py-4 font-medium text-white">{row.productName}</td>
                      <td className="px-4 py-4 text-slate-300">
                        {sumPrediction(row.prophetPrediction).toFixed(0)}
                      </td>
                      <td className="px-4 py-4 text-slate-300">
                        {sumPrediction(row.arimaPrediction).toFixed(0)}
                      </td>
                      <td className="px-4 py-4 text-slate-300">
                        {toNumber(row.prophetRMSE, 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-4 text-slate-300">
                        {toNumber(row.arimaRMSE, 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${getBetterModelBadgeClass(
                            row.betterModel
                          )}`}
                        >
                          {formatModelLabel(row.betterModel)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedComparison(row);
                            setComparisonModalOpen(true);
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/20"
                        >
                          View Comparison
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-slate-500/30 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-300">
              No comparison data available yet.
            </div>
          )}
        </section>

        <section className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
          <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
            Prediction Decisions
          </h3>

          {predictionsLoading ? (
            <div className="py-8 text-center text-slate-300">Loading predictions...</div>
          ) : predictionsError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{predictionsError}</span>
                <button
                  type="button"
                  onClick={() => loadPredictions({ forceRefresh: true })}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            </div>
          ) : hasPredictions ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-purple-500/20">
                  <tr>
                    <th className="px-4 py-4 font-semibold text-slate-300">Product Name</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Adjusted Prediction</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Decision</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Impact</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">News Signal</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Explanation</th>
                    <th className="px-4 py-4 font-semibold text-slate-300">Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((row, index) => (
                    <tr
                      key={`${row?.productId?.name || "product"}-${index}`}
                      className="border-b border-purple-500/10 transition-colors hover:bg-purple-500/5"
                    >
                      <td className="px-4 py-4 font-medium text-white">
                        {row?.productId?.name || "Unknown Product"}
                      </td>
                      <td className="px-4 py-4 text-slate-300">{toNumber(row?.adjustedPrediction, 0)}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${getDecisionBadgeClass(
                            row?.decision
                          )}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <BrainCircuit className="h-3.5 w-3.5" />
                            {formatDecision(row?.decision)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${getImpactBadgeClass(row?.impact)}`}>
                          {formatImpact(row?.impact)}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-4">
                        <div className="space-y-1.5 text-xs text-slate-200">
                          <p>Score: {toNumber(row?.score, 0).toFixed(1)}</p>
                          {row?.keyword ? <p>Keyword: {row.keyword}</p> : <p>Keyword: none</p>}
                          <div className="flex flex-wrap gap-1.5">
                            {(Array.isArray(row?.matchedKeywords) ? row.matchedKeywords : [])
                              .slice(0, 3)
                              .map((keyword, idx) => (
                                <span
                                  key={`${keyword}-${idx}`}
                                  className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100"
                                >
                                  {keyword}
                                </span>
                              ))}
                          </div>
                          {row?.sourceHeadline ? (
                            <p className="line-clamp-2 text-slate-400">{row.sourceHeadline}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-sm px-4 py-4 text-slate-200">
                        <p className="line-clamp-3">{formatReasonSummary(row?.reason)}</p>
                      </td>
                      <td className="max-w-sm px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(Array.isArray(row?.contributingFactors) ? row.contributingFactors : [])
                            .slice(0, 4)
                            .map((factor, factorIdx) => (
                              <span
                                key={`${factor?.key || "factor"}-${factorIdx}`}
                                className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-100"
                              >
                                {humanizeFactorKey(factor?.key)}: {formatFactorValue(factor?.value)}
                              </span>
                            ))}
                          {!Array.isArray(row?.contributingFactors) || row.contributingFactors.length === 0 ? (
                            <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-1 text-xs text-slate-300">
                              No factors
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-300">No predictions available</div>
          )}
        </section>

        {/* Table & Alerts Section */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ProductTable
              rows={analysis}
              onRunPrediction={runPrediction}
              onViewNews={openProductNews}
              newsLoadingById={newsLoadingById}
              predictionLoadingById={predictionLoadingById}
              predictionResultsById={predictionResultsById}
              predictionErrorById={predictionErrorById}
            />
          </div>
          <AlertList alerts={alerts} />
        </section>

        <NewsPanel
          isOpen={newsPanelOpen}
          isLoading={newsPanelLoading}
          error={newsPanelError}
          data={newsPanelData || { product: newsPanelProduct }}
          onClose={() => setNewsPanelOpen(false)}
          onRetry={retryNewsPanel}
        />
        <ComparisonModal
          isOpen={comparisonModalOpen}
          onClose={() => setComparisonModalOpen(false)}
          row={selectedComparison}
        />
      </main>
    </div>
  );
}
