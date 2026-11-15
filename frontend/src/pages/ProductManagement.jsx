import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../auth/authContextValue";
import { getSafeApiErrorLog, getSafeApiErrorMessage, isStaleTenantContextError } from "../services/authSupport";
import { productsApi } from "../services/api";

const emptyForm = { name: "", category: "" };

const readFieldErrors = (error) => error?.response?.data?.errors || {};

function ProductForm({ initialValue = emptyForm, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initialValue);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm(initialValue);
    setErrors({});
  }, [initialValue]);

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Name is required";
    if (!form.category.trim()) nextErrors.category = "Category is required";
    if (form.name.trim().length > 255) nextErrors.name = "Name must be 255 characters or fewer";
    if (form.category.trim().length > 100) nextErrors.category = "Category must be 100 characters or fewer";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    try {
      setSubmitting(true);
      setErrors({});
      await onSubmit({ name: form.name.trim(), category: form.category.trim() });
    } catch (error) {
      if (!isStaleTenantContextError(error)) {
        const fieldErrors = readFieldErrors(error);
        setErrors(Object.keys(fieldErrors).length
          ? fieldErrors
          : { form: getSafeApiErrorMessage(error, "Unable to save product.") });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5">
      <div>
        <label htmlFor="product-name" className="mb-1 block text-sm font-semibold text-slate-200">Name</label>
        <input
          id="product-name"
          value={form.name}
          maxLength={255}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-purple-400/60"
        />
        {errors.name ? <p className="mt-1 text-xs text-red-300">{errors.name}</p> : null}
      </div>
      <div>
        <label htmlFor="product-category" className="mb-1 block text-sm font-semibold text-slate-200">Category</label>
        <input
          id="product-category"
          value={form.category}
          maxLength={100}
          onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
          className="w-full rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-purple-400/60"
        />
        {errors.category ? <p className="mt-1 text-xs text-red-300">{errors.category}</p> : null}
      </div>
      {errors.form ? <p className="text-sm text-red-300">{errors.form}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={submitting} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {submitting ? "Saving..." : submitLabel}
        </button>
        {onCancel ? <button type="button" onClick={onCancel} className="rounded-lg border border-slate-500/30 px-4 py-2 text-sm text-slate-200">Cancel</button> : null}
      </div>
    </form>
  );
}

function StockForm({ product, onUpdated }) {
  const [mode, setMode] = useState(product.stockQuantity === 0 ? "set" : "adjust");
  const [quantity, setQuantity] = useState(product.stockQuantity === 0 ? "" : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const numeric = Number(quantity);
    if (!Number.isInteger(numeric) || (mode === "set" ? numeric < 0 : numeric === 0)) {
      setError(mode === "set" ? "Enter a non-negative whole-number balance." : "Enter a non-zero whole-number adjustment.");
      return;
    }
    if (!reason.trim()) { setError("A reason is required."); return; }
    try {
      setSubmitting(true);
      setError("");
      await productsApi.adjustStock(product.id, { mode, quantity: numeric, reason: reason.trim() });
      setQuantity("");
      setReason("");
      await onUpdated();
    } catch (requestError) {
      setError(getSafeApiErrorMessage(requestError, "Unable to update stock."));
    } finally {
      setSubmitting(false);
    }
  };

  return <form onSubmit={submit} className="mt-5 space-y-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
    <p className="text-sm font-semibold text-emerald-100">Stock management</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <select aria-label="Stock operation" value={mode} onChange={(event) => setMode(event.target.value)} className="rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="set">Initialize/set balance</option><option value="adjust">Adjust balance</option></select>
      <input aria-label="Stock quantity" type="number" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={mode === "set" ? "Target balance" : "Change (+/-)"} className="rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
      <input aria-label="Stock reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} placeholder="Reason" className="rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
    </div>
    {error ? <p className="text-sm text-red-300">{error}</p> : null}
    <button type="submit" disabled={submitting} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{submitting ? "Saving..." : "Save stock"}</button>
  </form>;
}

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "—";

export default function ProductManagement() {
  const { selectedTenantId } = useAuth();
  const { productId } = useParams();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await productsApi.getAll(search ? { search } : {});
      setProducts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        console.error("Product list error:", getSafeApiErrorLog(requestError));
        setError(getSafeApiErrorMessage(requestError, "Unable to load products."));
      }
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadProduct = useCallback(async () => {
    if (!productId) return;
    try {
      setLoading(true);
      setError("");
      const response = await productsApi.getById(productId);
      setProduct(response.data);
    } catch (requestError) {
      if (!isStaleTenantContextError(requestError)) {
        console.error("Product detail error:", getSafeApiErrorLog(requestError));
        setError(getSafeApiErrorMessage(requestError, "Unable to load this product."));
      }
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    setNotice("");
    setFormOpen(false);
    setEditing(false);
    setProduct(null);
    if (productId) loadProduct();
    else loadProducts();
  }, [selectedTenantId, productId, loadProduct, loadProducts]);

  const create = async (input) => {
    try {
      await productsApi.create(input);
      setFormOpen(false);
      setNotice("Product created successfully.");
      await loadProducts();
    } catch (requestError) {
      if (requestError?.response?.status === 409) {
        const error = new Error("duplicate");
        error.response = { data: { errors: { form: "A product with this name and category already exists." } } };
        throw error;
      }
      throw requestError;
    }
  };

  const update = async (input) => {
    await productsApi.update(product.id, input);
    setEditing(false);
    setNotice("Product updated successfully.");
    await loadProduct();
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${product.name}? Products with related sales, analytics, or stock movements cannot be deleted.`)) return;
    try {
      await productsApi.remove(product.id);
      navigate("/products", { replace: true });
    } catch (requestError) {
      setError(getSafeApiErrorMessage(requestError, "Unable to delete this product."));
    }
  };

  if (productId) {
    return (
      <div className="page-shell md:flex">
        <Sidebar />
        <main className="flex-1 space-y-6 p-4 md:p-8">
          <Link to="/products" className="text-sm text-purple-300 hover:text-purple-200">← Back to products</Link>
          {loading ? <p className="text-slate-300">Loading product...</p> : error ? <ErrorState message={error} onRetry={loadProduct} /> : product ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-sm uppercase tracking-wide text-slate-400">Product details</p><h1 className="mt-1 text-3xl font-bold text-white">{product.name}</h1></div>
                <div className="flex gap-2"><button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-purple-400/30 px-4 py-2 text-sm font-semibold text-purple-100">Edit</button><button type="button" onClick={remove} className="rounded-lg border border-red-400/30 px-4 py-2 text-sm font-semibold text-red-200">Delete</button></div>
              </div>
              {notice ? <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{notice}</p> : null}
              {editing ? <ProductForm initialValue={{ name: product.name, category: product.category }} submitLabel="Save changes" onSubmit={update} onCancel={() => setEditing(false)} /> : (
                <div className="grid gap-4 sm:grid-cols-2"><Detail label="Category" value={product.category} /><Detail label="Current stock" value={product.stockQuantity === null ? "Unavailable until migration 006" : product.stockQuantity} /><Detail label="Created" value={formatDate(product.createdAt)} /><Detail label="Last updated" value={formatDate(product.updatedAt)} /><Detail label="Product ID" value={product.id} /></div>
              )}
              {product.stockQuantity !== null ? <StockForm product={product} onUpdated={loadProduct} /> : null}
            </>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm uppercase tracking-wide text-slate-400">Catalog</p><h1 className="text-3xl font-bold text-white">Products</h1><p className="mt-2 text-slate-400">Manage this tenant's product catalogue.</p></div><button type="button" onClick={() => { setFormOpen(true); setNotice(""); }} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white">Add product</button></div>
        {notice ? <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{notice}</p> : null}
        {formOpen ? <ProductForm submitLabel="Create product" onSubmit={create} onCancel={() => setFormOpen(false)} /> : null}
        <form onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }} className="flex max-w-xl gap-2"><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search name or category" className="min-w-0 flex-1 rounded-lg border border-slate-500/30 bg-slate-950 px-3 py-2 text-sm text-slate-100" /><button type="submit" className="rounded-lg border border-slate-500/30 px-4 py-2 text-sm font-semibold text-slate-200">Search</button>{search ? <button type="button" onClick={() => { setSearch(""); setSearchInput(""); }} className="rounded-lg border border-slate-500/30 px-3 py-2 text-sm text-slate-300">Clear</button> : null}</form>
        {loading ? <p className="text-slate-300">Loading products...</p> : error ? <ErrorState message={error} onRetry={loadProducts} /> : products.length === 0 ? <div className="rounded-2xl border border-slate-500/20 bg-slate-900/40 p-8 text-center text-slate-400">{search ? "No products match your search." : "No products yet. Add the first product to start your catalogue."}</div> : (
          <div className="overflow-x-auto rounded-2xl border border-purple-500/20 bg-slate-900/40"><table className="min-w-full text-left text-sm"><thead className="border-b border-purple-500/20 text-slate-300"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Current stock</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{products.map((item) => <tr key={item.id} className="border-b border-slate-500/10 text-slate-200"><td className="px-4 py-3 font-semibold">{item.name}</td><td className="px-4 py-3">{item.category}</td><td className="px-4 py-3">{item.stockQuantity === null ? "—" : item.stockQuantity}</td><td className="px-4 py-3 text-slate-400">{formatDate(item.createdAt)}</td><td className="px-4 py-3"><Link to={`/products/${item.id}`} className="text-purple-300 hover:text-purple-200">View details</Link></td></tr>)}</tbody></table></div>
        )}
      </main>
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="rounded-xl border border-slate-500/20 bg-slate-900/40 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 break-all text-sm text-slate-100">{value || "—"}</p></div>;
}

function ErrorState({ message, onRetry }) {
  return <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"><p>{message}</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-semibold">Retry</button></div>;
}
