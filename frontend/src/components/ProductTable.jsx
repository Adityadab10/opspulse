import { Fragment } from "react";

const getDecision = (percent) => {
  if (percent > 10) return { 
    label: "Increase", 
    color: "bg-green-500/20 text-green-400 border border-green-500/30" 
  };
  if (percent < -10) return { 
    label: "Reduce", 
    color: "bg-red-500/20 text-red-400 border border-red-500/30" 
  };
  return { 
    label: "Maintain", 
    color: "bg-amber-500/20 text-amber-400 border border-amber-500/30" 
  };
};

const getPredictionDecisionBadgeClass = (decision) => {
  const normalized = String(decision || "").toLowerCase();

  if (normalized === "increase") {
    return "bg-green-500/20 text-green-300 border border-green-500/30";
  }
  if (normalized === "reduce") {
    return "bg-red-500/20 text-red-300 border border-red-500/30";
  }
  return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
};

const formatPredictionDecision = (decision) => {
  const normalized = String(decision || "").toLowerCase();
  if (!normalized) return "Maintain";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatConfidence = (confidence) => {
  if (typeof confidence === "string") {
    return confidence;
  }

  const value = Number(confidence);
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(1)}%`;
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

export default function ProductTable({
  rows,
  onRunPrediction,
  onViewNews,
  newsLoadingById = {},
  predictionLoadingById = {},
  predictionResultsById = {},
  predictionErrorById = {},
}) {
  return (
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Product Analysis
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-purple-500/20">
            <tr>
              <th className="px-4 py-4 font-semibold text-slate-300">Product Name</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Category</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Avg Monthly Sales</th>
              <th className="px-4 py-4 font-semibold text-slate-300">% Change</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Decision</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = getDecision(row.percentChange);
              const rowId = row?.productId;
              const loading = Boolean(predictionLoadingById?.[rowId]);
              const newsLoading = Boolean(newsLoadingById?.[rowId]);
              const prediction = predictionResultsById?.[rowId];
              const predictionError = predictionErrorById?.[rowId];

              return (
                <Fragment key={(rowId || row.name) + i}>
                  <tr
                    className="border-b border-purple-500/10 transition-colors hover:bg-purple-500/5"
                  >
                    <td className="px-4 py-4 font-medium text-white">{row.name}</td>
                    <td className="px-4 py-4 text-slate-400">{row.category}</td>
                    <td className="px-4 py-4 text-slate-400">{row.avgSales}</td>
                    <td className="px-4 py-4 text-slate-400">{row.percentChange}%</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${d.color}`}>
                        {d.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => onRunPrediction?.(rowId)}
                          disabled={loading || !rowId}
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-500/20 px-3 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loading && (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200/40 border-t-indigo-200"></span>
                          )}
                          {loading ? "Running..." : "Run Prediction"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onViewNews?.({
                              productId: rowId,
                              name: row?.name,
                              category: row?.category,
                            })
                          }
                          disabled={newsLoading || !rowId}
                          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {newsLoading && (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-100/40 border-t-cyan-100"></span>
                          )}
                          {newsLoading ? "Loading..." : "View News"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {(prediction || predictionError) && (
                    <tr className="border-b border-purple-500/10 bg-slate-900/20">
                      <td className="px-4 py-4" colSpan={6}>
                        {predictionError ? (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                            {predictionError}
                          </div>
                        ) : (
                          <div className="space-y-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">Rule Prediction</p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  {prediction?.rulePrediction ?? "-"}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">ML Prediction</p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  {prediction?.mlPrediction ?? "-"}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">Adjusted Prediction</p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  {prediction?.adjustedPrediction ?? "-"}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">Decision</p>
                                <p className="mt-1">
                                  <span
                                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${getPredictionDecisionBadgeClass(
                                      prediction?.decision
                                    )}`}
                                  >
                                    {formatPredictionDecision(prediction?.decision)}
                                  </span>
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">Confidence</p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  {formatConfidence(prediction?.confidence)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">News Score</p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  {Number.isFinite(Number(prediction?.score))
                                    ? Number(prediction.score).toFixed(1)
                                    : "0.0"}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">Keyword</p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  {prediction?.keyword || "none"}
                                </p>
                              </div>
                            </div>

                            <div>
                              <p className="text-xs uppercase tracking-wide text-slate-400">Reason</p>
                              <p className="mt-1 text-sm text-slate-200">
                                {prediction?.reason || "No explanation available."}
                              </p>
                            </div>

                            <div>
                              <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Contributing Factors</p>
                              <div className="flex flex-wrap gap-2">
                                {(Array.isArray(prediction?.contributingFactors)
                                  ? prediction.contributingFactors
                                  : []
                                ).map((factor, idx) => (
                                  <span
                                    key={`${factor?.key || "factor"}-${idx}`}
                                    className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-100"
                                  >
                                    {humanizeFactorKey(factor?.key)}: {formatFactorValue(factor?.value)}
                                  </span>
                                ))}
                                {!Array.isArray(prediction?.contributingFactors) ||
                                prediction.contributingFactors.length === 0 ? (
                                  <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2.5 py-1 text-xs text-slate-300">
                                    No factors available
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {prediction?.sourceHeadline ? (
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-400">Source Headline</p>
                                <p className="mt-1 text-sm text-slate-200">{prediction.sourceHeadline}</p>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                  No analysis data found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}