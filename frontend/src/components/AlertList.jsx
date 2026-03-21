const severityStyle = {
  LOW: "bg-sky-100 text-sky-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  HIGH: "bg-red-100 text-red-700",
};

export default function AlertList({ alerts }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">Active Alerts</h3>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert._id}
            className="rounded-lg border border-slate-200 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">
                {alert.productId?.name || "Unknown Product"}
              </p>
              <span
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  severityStyle[alert.severity] || "bg-slate-100 text-slate-700"
                }`}
              >
                {alert.severity || "N/A"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{alert.message}</p>
          </div>
        ))}
        {!alerts.length && <p className="text-sm text-slate-500">No active alerts.</p>}
      </div>
    </div>
  );
}