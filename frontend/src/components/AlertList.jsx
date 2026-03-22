const severityStyle = {
  LOW: "bg-sky-500/20 text-sky-400 border border-sky-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  HIGH: "bg-red-500/20 text-red-400 border border-red-500/30",
};

const severityIcon = {
  LOW: "ℹ️",
  MEDIUM: "⚠️",
  HIGH: "🚨",
};

export default function AlertList({ alerts }) {
  return (
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Active Alerts
      </h3>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert._id}
            className="group rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 transition-all hover:border-purple-500/40 hover:bg-purple-500/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {severityIcon[alert.severity] || "📋"}
                  </span>
                  <p className="font-semibold text-white">
                    {alert.productId?.name || "Unknown Product"}
                  </p>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {alert.message}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  severityStyle[alert.severity] || "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                }`}
              >
                {alert.severity || "N/A"}
              </span>
            </div>
          </div>
        ))}
        {!alerts.length && (
          <div className="rounded-xl border border-purple-500/10 bg-purple-500/5 p-8 text-center">
            <p className="text-sm text-slate-400">No active alerts.</p>
          </div>
        )}
      </div>
    </div>
  );
}