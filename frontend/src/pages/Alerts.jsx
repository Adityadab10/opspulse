import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import { alertsApi } from "../services/api";

const severityClass = {
  LOW: "bg-sky-500/20 text-sky-400 border border-sky-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  HIGH: "bg-red-500/20 text-red-400 border border-red-500/30",
};

const severityIcon = {
  LOW: "ℹ️",
  MEDIUM: "⚠️",
  HIGH: "🚨",
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
      <main className="flex-1 p-4 md:p-8">
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-white via-purple-200 to-purple-400 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Alerts
          </h1>
          <p className="mt-2 text-slate-400">
            Stay informed about critical inventory changes and recommendations
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center space-y-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500/20 border-t-purple-500"></div>
              <p className="text-slate-300">Loading alerts...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map((alert) => (
              <article
                key={alert._id}
                className="glass group rounded-2xl p-6 transition-all hover:scale-[1.01] hover:border-purple-500/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">
                        {severityIcon[alert.severity] || "📋"}
                      </span>
                      <h3 className="text-xl font-semibold text-white">
                        {alert.productId?.name || "Unknown Product"}
                      </h3>
                    </div>
                    <p className="mt-3 leading-relaxed text-slate-300">
                      {alert.message}
                    </p>
                    <p className="mt-3 text-xs text-slate-500">
                      {new Date(alert.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
                      severityClass[alert.severity] || "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                    }`}
                  >
                    {alert.severity || "N/A"}
                  </span>
                </div>
              </article>
            ))}
            {!alerts.length && (
              <div className="glass rounded-2xl p-12 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/10">
                  <span className="text-3xl">✓</span>
                </div>
                <p className="text-lg font-semibold text-white">All Clear!</p>
                <p className="mt-2 text-slate-400">No active alerts at the moment.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}