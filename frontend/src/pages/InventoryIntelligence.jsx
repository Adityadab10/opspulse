import { useCallback, useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../auth/authContextValue";
import { getSafeApiErrorLog, getSafeApiErrorMessage, isStaleTenantContextError } from "../services/authSupport";
import { inventoryApi } from "../services/api";

const emptyState = { products: [], alerts: [], summary: {} };
const severityClass = { critical: "border-red-400/40 bg-red-500/10", high: "border-orange-400/40 bg-orange-500/10", medium: "border-yellow-400/40 bg-yellow-500/10", low: "border-slate-400/30 bg-slate-500/10" };
const formatDemand = (value) => value == null ? "Forecast unavailable" : `${value} units`;

function FindingTable({ title, products, predicate, emptyText }) {
  const rows = products.filter(predicate);
  return <section className="rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5">
    <h2 className="text-lg font-semibold text-white">{title}</h2>
    {rows.length === 0 ? <p className="mt-3 text-sm text-slate-400">{emptyText}</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="p-2">Product</th><th className="p-2">Stock</th><th className="p-2">Expected demand</th><th className="p-2">Suggested reorder</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-slate-700/50"><td className="p-2 text-slate-100">{row.name}</td><td className="p-2 text-slate-200">{row.currentStock}</td><td className="p-2 text-slate-300">{formatDemand(row.expectedDemand)}</td><td className="p-2 text-emerald-200">{row.recommendedReorderQuantity == null ? "—" : `${row.recommendedReorderQuantity} units`}</td></tr>)}</tbody></table></div>}
  </section>;
}

export default function InventoryIntelligence() {
  const { selectedTenantId } = useAuth();
  const [horizon, setHorizon] = useState("30");
  const [data, setData] = useState(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!selectedTenantId) return;
    try { setLoading(true); setError(""); const response = await inventoryApi.getIntelligence({ horizon }); setData(response.data || emptyState); }
    catch (requestError) { setData(emptyState); if (!isStaleTenantContextError(requestError)) { console.error("Inventory intelligence error:", getSafeApiErrorLog(requestError)); setError(getSafeApiErrorMessage(requestError, "Unable to load inventory intelligence.")); } }
    finally { setLoading(false); }
  }, [selectedTenantId, horizon]);
  useEffect(() => { setData(emptyState); setError(""); load(); }, [load, selectedTenantId]);
  const products = data.products || [];
  const summary = data.summary || {};
  return <div className="flex min-h-screen flex-col bg-black text-white md:flex-row"><Sidebar /><main className="flex-1 p-5 md:p-8"><div className="mx-auto max-w-7xl space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm uppercase tracking-[0.25em] text-purple-300">Decision support</p><h1 className="mt-2 text-3xl font-bold">Inventory Intelligence</h1><p className="mt-2 text-slate-400">Advisory calculations from current stock and persisted demand forecasts.</p></div><label className="text-sm text-slate-300">Forecast horizon<select value={horizon} onChange={(event) => setHorizon(event.target.value)} className="ml-2 rounded-lg border border-slate-500/30 bg-slate-900 px-3 py-2 text-slate-100"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label></div>
    {loading ? <div className="rounded-2xl border border-purple-500/20 bg-slate-900/50 p-8 text-slate-300">Loading inventory intelligence…</div> : error ? <div className="rounded-2xl border border-red-400/30 bg-red-950/30 p-6"><p className="text-red-200">{error}</p><button type="button" onClick={load} className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold">Retry</button></div> : <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[["Products", summary.totalProducts], ["Low stock", summary.lowStockProducts], ["Stockout risk", summary.stockoutRiskProducts], ["Overstocked", summary.overstockedProducts], ["Alerts", summary.alertCount]].map(([label, value]) => <div key={label} className="rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold text-white">{value ?? 0}</p></div>)}</div><p className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-4 text-sm text-cyan-100">{data.calculationPolicy}</p>{products.length === 0 ? <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-8 text-slate-400">No products are available for this tenant.</div> : <><FindingTable title="Low-stock products" products={products} predicate={(row) => row.lowStock} emptyText="No products are at or below their configured reorder threshold." /><FindingTable title="Stockout-risk products" products={products} predicate={(row) => row.stockoutRisk} emptyText="No stockout risk is identified from available forecasts." /><FindingTable title="Overstocked products" products={products} predicate={(row) => row.overstock} emptyText="No products meet the explicit overstock policy." /></>}{products.length > 0 ? <FindingTable title="Reorder recommendations" products={products} predicate={(row) => Number(row.recommendedReorderQuantity) > 0} emptyText="No replenishment is suggested for the selected horizon." /> : null}
    <section className="rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5"><h2 className="text-lg font-semibold">Prioritized alerts</h2>{data.alerts?.length ? <div className="mt-4 space-y-3">{data.alerts.map((alert) => <div key={alert.key} className={`rounded-xl border p-4 ${severityClass[alert.severity] || severityClass.low}`}><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{alert.productName} · {alert.type.replaceAll("_", " ")}</p><span className="text-xs uppercase text-slate-300">{alert.severity}</span></div><p className="mt-1 text-sm text-slate-300">{alert.reason}</p><p className="mt-1 text-sm text-emerald-200">Action: {alert.action}</p></div>)}</div> : <p className="mt-3 text-sm text-slate-400">No active inventory findings.</p>}</section>
    {summary.missingForecastProducts > 0 ? <p className="text-sm text-amber-200">{summary.missingForecastProducts} product(s) have no persisted forecast. Stockout and overstock decisions remain unknown for those products; generate a forecast first.</p> : null}</>}</div></main></div>;
}
