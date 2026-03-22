import { useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar";
import { uploadApi } from "../services/api";

export default function Upload() {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return toast.error("Please select a CSV file first.");

    try {
      setSubmitting(true);
      await uploadApi.uploadCsv(file);
      toast.success("Sales data uploaded successfully");
      setFile(null);
      e.target.reset();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(error?.response?.data?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8">
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-white via-purple-200 to-purple-400 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Upload CSV
          </h1>
          <p className="mt-2 text-slate-400">
            Import your historical sales data to generate predictions
          </p>
        </div>

        <form
          onSubmit={handleUpload}
          className="glass max-w-2xl rounded-2xl p-8 transition-all hover:border-purple-500/40"
        >
          <div className="mb-6">
            <label className="mb-3 block text-sm font-semibold text-slate-300">
              📁 Upload sales CSV file
            </label>
            <div className="group relative">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full cursor-pointer rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 text-slate-300 outline-none transition file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-purple-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-purple-500/40 hover:bg-purple-500/10 file:hover:bg-purple-700"
              />
            </div>
            {file && (
              <p className="mt-3 text-sm text-purple-400">
                ✓ Selected: <span className="font-semibold">{file.name}</span>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
            <p className="mb-2 text-sm font-semibold text-slate-300">💡 CSV Format:</p>
            <code className="block text-xs text-slate-400">
              product_id, product_name, quantity_sold, sale_date, price
            </code>
          </div>

          <button
            type="submit"
            disabled={submitting || !file}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 font-semibold text-white shadow-lg shadow-purple-900/40 transition-all hover:scale-105 hover:shadow-xl hover:shadow-purple-900/50 disabled:opacity-60 disabled:hover:scale-100"
          >
            {submitting ? "⏳ Uploading..." : "🚀 Upload & Process"}
          </button>
        </form>
      </main>
    </div>
  );
}