import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../auth/authContextValue";
import { getSafeApiErrorLog, getSafeApiErrorMessage, isStaleTenantContextError } from "../services/authSupport";
import { forecastApi, productsApi } from "../services/api";
import { buildForecastSeries, validateForecastOptions } from "../services/forecastSupport";

export default function Forecasting() {
  const { selectedTenantId } = useAuth();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState("");
  const [horizon, setHorizon] = useState(30);
  const [model, setModel] = useState("auto");
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await productsApi.getAll();
      const rows = Array.isArray(response.data) ? response.data : [];
      setProducts(rows);
      setProductId((current) => rows.some((product) => product.id === current) ? current : rows[0]?.id || "");
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        console.error("Forecast products error:", getSafeApiErrorLog(requestError));
        setError(getSafeApiErrorMessage(requestError, "Unable to load products."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setForecast(null);
    setProducts([]);
    setProductId("");
    setError("");
    setFormError("");
    loadProducts();
  }, [selectedTenantId, loadProducts]);

  const series = useMemo(() => buildForecastSeries(forecast?.historical, forecast?.forecast), [forecast]);

  const generate = async (event) => {
    event.preventDefault();
    const errors = validateForecastOptions({ productId, horizon });
    if (Object.keys(errors).length) { setFormError(Object.values(errors)[0]); return; }
    try {
      setGenerating(true);
      setFormError("");
      setError("");
      const response = await forecastApi.getProductForecast(productId, { horizon: Number(horizon), model });
      setForecast(response.data);
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        console.error("Forecast generation error:", getSafeApiErrorLog(requestError));
        setError(getSafeApiErrorMessage(requestError, "Unable to generate forecast."));
        setForecast(null);
      }
    } finally {
      setGenerating(false);
    }
  };

  const product = products.find((item) => item.id === productId);
  return <div className="page-shell md:flex"><Sidebar /><main className="flex-1 space-y-6 p-4 md:p-8">
    <div><p className="text-sm uppercase tracking-wide text-slate-400">Planning</p><h1 className="text-3xl font-bold text-white">Demand forecasting</h1><p className="mt-2 text-slate-400">Use recorded sales quantities to estimate future daily demand.</p></div>
    <form onSubmit={generate} className="grid gap-4 rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5 md:grid-cols-4">
      <div><label htmlFor="forecast-product" className="mb-1 block text-sm font-semibold text-slate-200">Product</label><select id="forecast-product" value={productId} onChange={(event) => { setProductId(event.target.value); setForecast(null); }} disabled={loading} className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100"><option value="">Select product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select></div>
      <div><label htmlFor="forecast-horizon" className="mb-1 block text-sm font-semibold text-slate-200">Horizon (days)</label><input id="forecast-horizon" type="number" min="1" max="90" value={horizon} onChange={(event) => setHorizon(event.target.value)} className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100" /></div>
      <div><label htmlFor="forecast-model" className="mb-1 block text-sm font-semibold text-slate-200">Model</label><select id="forecast-model" value={model} onChange={(event) => setModel(event.target.value)} className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100"><option value="auto">Automatic selection</option><option value="prophet">Prophet</option><option value="arima">ARIMA</option></select></div>
      <div className="flex items-end"><button type="submit" disabled={generating || loading || !products.length} className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{generating ? "Generating..." : "Generate forecast"}</button></div>
      {formError ? <p className="text-sm text-red-300 md:col-span-4">{formError}</p> : null}
    </form>
    {error ? <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"><p>{error}</p><button type="button" onClick={loadProducts} className="mt-3 rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-semibold">Retry</button></div> : null}
    {!loading && !error && !products.length ? <div className="rounded-2xl border border-slate-500/20 bg-slate-900/40 p-8 text-center text-slate-400">Add a product before generating a forecast.</div> : null}
    {forecast ? <>
      <div className="grid gap-4 sm:grid-cols-4"><Summary label="Product" value={forecast.product?.name || product?.name || "Selected product"} /><Summary label="Model" value={forecast.selectedModel || "—"} /><Summary label="Horizon" value={`${forecast.horizon} days`} /><Summary label="Generated" value={forecast.generatedAt ? new Date(forecast.generatedAt).toLocaleString() : "—"} /></div>
      <div className="rounded-2xl border border-purple-500/20 bg-slate-900/40 p-5"><h2 className="mb-4 text-lg font-semibold text-white">Historical and predicted demand</h2><div className="h-80 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={series}><CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" /><XAxis dataKey="date" stroke="#a5a8be" /><YAxis stroke="#a5a8be" /><Tooltip /><Legend /><Line type="monotone" dataKey="historical" name="Historical demand" stroke="#38bdf8" connectNulls={false} /><Line type="monotone" dataKey="forecast" name="Predicted demand" stroke="#c084fc" connectNulls={false} /></LineChart></ResponsiveContainer></div></div>
      <div className="overflow-x-auto rounded-2xl border border-slate-500/20 bg-slate-900/40"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-500/20 text-slate-300"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Units</th></tr></thead><tbody>{series.map((point) => <tr key={`${point.date}-${point.forecast === null ? "historical" : "forecast"}`} className="border-b border-slate-500/10 text-slate-200"><td className="px-4 py-3">{point.date}</td><td className="px-4 py-3">{point.forecast === null ? "Historical" : "Predicted"}</td><td className="px-4 py-3">{point.forecast === null ? point.historical : point.forecast}</td></tr>)}</tbody></table></div>
    </> : null}
    {!forecast && !loading && !error && products.length ? <div className="rounded-2xl border border-slate-500/20 bg-slate-900/40 p-8 text-center text-slate-400">Select a product and generate a forecast. At least five daily sales observations are required.</div> : null}
  </main></div>;
}

function Summary({ label, value }) {
  return <div className="rounded-xl border border-slate-500/20 bg-slate-900/40 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-sm text-slate-100">{value}</p></div>;
}
