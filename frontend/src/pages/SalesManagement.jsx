import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../auth/authContextValue";
import { getSafeApiErrorLog, getSafeApiErrorMessage, isStaleTenantContextError } from "../services/authSupport";
import { productsApi, salesApi } from "../services/api";
import { validateSaleInput } from "../services/salesSupport";

const initialSale = () => ({
  productId: "",
  date: new Date().toISOString().slice(0, 16),
  quantity: "",
});

const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";

export default function SalesManagement() {
  const { selectedTenantId } = useAuth();
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [filters, setFilters] = useState({ productId: "", start: "", end: "" });
  const [sale, setSale] = useState(initialSale);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [notice, setNotice] = useState("");

  const loadProducts = useCallback(async () => {
    try {
      setProductsLoading(true);
      const response = await productsApi.getAll();
      setProducts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        console.error("Sales product list error:", getSafeApiErrorLog(requestError));
        setError(getSafeApiErrorMessage(requestError, "Unable to load products."));
      }
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadSales = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const response = await salesApi.getHistory(params);
      setSales(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        console.error("Sales history error:", getSafeApiErrorLog(requestError));
        setError(getSafeApiErrorMessage(requestError, "Unable to load sales history."));
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    setSales([]);
    setProducts([]);
    setError("");
    setNotice("");
    setFormErrors({});
    setSale(initialSale());
    loadProducts();
    loadSales();
  }, [selectedTenantId, loadProducts, loadSales]);

  const selectedProduct = useMemo(() => products.find((product) => product.id === sale.productId), [products, sale.productId]);

  const submitSale = async (event) => {
    event.preventDefault();
    const errors = validateSaleInput(sale);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }
    try {
      setSubmitting(true);
      setFormErrors({});
      await salesApi.create({ productId: sale.productId, date: new Date(sale.date).toISOString(), quantity: Number(sale.quantity) });
      setSale(initialSale());
      setNotice("Sale recorded successfully.");
      await loadSales();
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        const backendErrors = requestError?.response?.data?.errors || {};
        setFormErrors(Object.keys(backendErrors).length ? backendErrors : { form: getSafeApiErrorMessage(requestError, "Unable to record sale.") });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 space-y-6 p-4 md:p-8">
        <div><p className="text-sm uppercase tracking-wide text-slate-400">Transactions</p><h1 className="text-3xl font-bold text-white">Sales</h1><p className="mt-2 text-slate-400">Record completed sales and review this tenant&apos;s history.</p></div>
        {notice ? <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{notice}</p> : null}
        <form onSubmit={submitSale} className="grid gap-4 rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5 md:grid-cols-4">
          <div><label htmlFor="sale-product" className="mb-1 block text-sm font-semibold text-slate-200">Product</label><select id="sale-product" value={sale.productId} onChange={(event) => setSale((current) => ({ ...current, productId: event.target.value }))} disabled={productsLoading} className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100"><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.category}</option>)}</select>{formErrors.productId ? <p className="mt-1 text-xs text-red-300">{formErrors.productId}</p> : null}</div>
          <div><label htmlFor="sale-date" className="mb-1 block text-sm font-semibold text-slate-200">Date and time</label><input id="sale-date" type="datetime-local" value={sale.date} onChange={(event) => setSale((current) => ({ ...current, date: event.target.value }))} className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100" />{formErrors.date ? <p className="mt-1 text-xs text-red-300">{formErrors.date}</p> : null}</div>
          <div><label htmlFor="sale-quantity" className="mb-1 block text-sm font-semibold text-slate-200">Quantity</label><input id="sale-quantity" type="number" min="1" step="1" value={sale.quantity} onChange={(event) => setSale((current) => ({ ...current, quantity: event.target.value }))} className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100" />{formErrors.quantity ? <p className="mt-1 text-xs text-red-300">{formErrors.quantity}</p> : null}</div>
          <div className="flex items-end"><button type="submit" disabled={submitting || productsLoading || !products.length} className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{submitting ? "Recording..." : "Record sale"}</button></div>
          {formErrors.form ? <p className="text-sm text-red-300 md:col-span-4">{formErrors.form}</p> : null}
        </form>
        <form onSubmit={(event) => { event.preventDefault(); loadSales(); }} className="grid gap-3 rounded-2xl border border-slate-500/20 bg-slate-900/40 p-5 md:grid-cols-4">
          <select aria-label="Filter by product" value={filters.productId} onChange={(event) => setFilters((current) => ({ ...current, productId: event.target.value }))} className="rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="">All products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
          <input aria-label="Filter start date" type="date" value={filters.start} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} className="rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          <input aria-label="Filter end date" type="date" value={filters.end} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} className="rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          <button type="submit" className="rounded-lg border border-slate-500/30 px-4 py-2 text-sm font-semibold text-slate-200">Apply filters</button>
        </form>
        {error ? <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"><p>{error}</p><button type="button" onClick={() => { loadProducts(); loadSales(); }} className="mt-3 rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-semibold">Retry</button></div> : null}
        {loading ? <p className="text-slate-300">Loading sales...</p> : !error && sales.length === 0 ? <div className="rounded-2xl border border-slate-500/20 bg-slate-900/40 p-8 text-center text-slate-400">No sales match the selected filters.</div> : !error ? <div className="overflow-x-auto rounded-2xl border border-purple-500/20 bg-slate-900/40"><table className="min-w-full text-left text-sm"><thead className="border-b border-purple-500/20 text-slate-300"><tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Sale date</th><th className="px-4 py-3">Recorded</th></tr></thead><tbody>{sales.map((item) => <tr key={item.id} className="border-b border-slate-500/10 text-slate-200"><td className="px-4 py-3 font-semibold">{item.productName}{item.productCategory ? <span className="ml-2 text-xs font-normal text-slate-400">{item.productCategory}</span> : null}</td><td className="px-4 py-3">{item.quantity}</td><td className="px-4 py-3">{formatDate(item.date)}</td><td className="px-4 py-3 text-slate-400">{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : null}
        {selectedProduct ? <p className="text-xs text-slate-500">Recording for {selectedProduct.name}; stock availability is not shown because the current schema has no stock quantity.</p> : null}
      </main>
    </div>
  );
}
