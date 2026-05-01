import { X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildSeriesData = (actualValues, prophetValues, arimaValues) => {
  const actual = Array.isArray(actualValues) ? actualValues : [];
  const prophet = Array.isArray(prophetValues) ? prophetValues : [];
  const arima = Array.isArray(arimaValues) ? arimaValues : [];

  const maxLength = Math.max(actual.length, prophet.length, arima.length, 0);

  return Array.from({ length: maxLength }, (_, index) => ({
    period: `P${index + 1}`,
    Actual: toNumber(actual[index], null),
    Prophet: toNumber(prophet[index], null),
    ARIMA: toNumber(arima[index], null),
  }));
};

const buildMetricData = (row) => [
  {
    metric: "RMSE",
    Prophet: toNumber(row?.prophetRMSE, 0),
    ARIMA: toNumber(row?.arimaRMSE, 0),
  },
  {
    metric: "MAE",
    Prophet: toNumber(row?.prophetMAE, 0),
    ARIMA: toNumber(row?.arimaMAE, 0),
  },
  {
    metric: "MAPE",
    Prophet: toNumber(row?.prophetMAPE, 0),
    ARIMA: toNumber(row?.arimaMAPE, 0),
  },
];

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

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-xl p-3 shadow-lg">
        <p className="mb-2 font-semibold text-white">{label}</p>
        {payload.map((entry) => (
          <p key={entry.dataKey} className="text-sm text-slate-300" style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ComparisonModal({ isOpen, onClose, row }) {
  if (!isOpen || !row) {
    return null;
  }

  const seriesData = buildSeriesData(row.actualValues, row.prophetPrediction, row.arimaPrediction);
  const metricData = buildMetricData(row);
  const hasSeriesData = seriesData.length > 0;
  const actualValues = Array.isArray(row.actualValues) ? row.actualValues : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center">
      <div className="glass max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-purple-500/20 bg-slate-950/60 p-6 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
              Forecast Comparison
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {row.productName || "Selected product"} • Model accuracy breakdown
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-500/20"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-blue-200">Prophet Prediction</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {Array.isArray(row.prophetPrediction)
                ? row.prophetPrediction.reduce((sum, value) => sum + toNumber(value, 0), 0).toFixed(0)
                : toNumber(row.prophetPrediction, 0).toFixed(0)}
            </p>
          </div>
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-purple-200">ARIMA Prediction</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {Array.isArray(row.arimaPrediction)
                ? row.arimaPrediction.reduce((sum, value) => sum + toNumber(value, 0), 0).toFixed(0)
                : toNumber(row.arimaPrediction, 0).toFixed(0)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-400">Better Model</span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${getBetterModelBadgeClass(
              row.betterModel
            )}`}
          >
            {formatModelLabel(row.betterModel)}
          </span>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="glass rounded-xl p-4">
            <h4 className="text-sm font-semibold text-slate-200">Actual vs Forecasts</h4>
            <div className="mt-4 h-64 w-full">
              {hasSeriesData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ReLineChart data={seriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                    <XAxis dataKey="period" stroke="#a5a8be" style={{ fontSize: "12px" }} />
                    <YAxis stroke="#a5a8be" style={{ fontSize: "12px" }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: "#a5a8be", fontSize: "12px" }} />
                    <Line type="monotone" dataKey="Actual" stroke="#22c55e" strokeWidth={2} />
                    <Line type="monotone" dataKey="Prophet" stroke="#3b82f6" strokeWidth={2} />
                    <Line type="monotone" dataKey="ARIMA" stroke="#a855f7" strokeWidth={2} />
                  </ReLineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  No forecast series available.
                </div>
              )}
            </div>
          </div>

          <div className="glass rounded-xl p-4">
            <h4 className="text-sm font-semibold text-slate-200">Accuracy Metrics</h4>
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metricData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis dataKey="metric" stroke="#a5a8be" style={{ fontSize: "12px" }} />
                  <YAxis stroke="#a5a8be" style={{ fontSize: "12px" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: "#a5a8be", fontSize: "12px" }} />
                  <Bar dataKey="Prophet" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="ARIMA" fill="#a855f7" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-200">Actual Values</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {actualValues.length > 0 ? (
              actualValues.slice(0, 16).map((value, index) => (
                <span
                  key={`actual-${index}`}
                  className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100"
                >
                  {toNumber(value, 0).toFixed(0)}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-400">No actual values available.</span>
            )}
            {actualValues.length > 16 ? (
              <span className="text-xs text-slate-500">
                +{actualValues.length - 16} more
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
