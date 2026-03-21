import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import { alertsApi } from "../services/api";

const severityClass = {
  LOW: "bg-sky-100 text-sky-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  HIGH: "bg-red-100 text-red-700",
};

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAlerts = async () => {
      try {
        setLoading(true);
        const res = await alertsApi.getAlerts();
        setAlerts(res.data || []);
      } catch (err) {
        console.error("Alerts fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    loadAlerts();
  }, []);

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Alerts</h1>

        {loading ? (
          <p className="text-slate-600">Loading alerts...</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <article
                key={alert._id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">
                    {alert.productId?.name || "Unknown Product"}
                  </h3>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      severityClass[alert.severity] || "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {alert.severity || "N/A"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{alert.message}</p>
              </article>
            ))}
            {!alerts.length && <p className="text-slate-500">No active alerts.</p>}
          </div>
        )}
      </main>
    </div>
  );
}