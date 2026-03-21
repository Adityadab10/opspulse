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
      <main className="flex-1 p-4 md:p-6">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Upload CSV</h1>

        <form
          onSubmit={handleUpload}
          className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Upload sales CSV file
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full rounded-lg border border-slate-300 p-2.5"
          />
          <button
            type="submit"
            disabled={submitting}
            className="mt-4 rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {submitting ? "Uploading..." : "Upload"}
          </button>
        </form>
      </main>
    </div>
  );
}