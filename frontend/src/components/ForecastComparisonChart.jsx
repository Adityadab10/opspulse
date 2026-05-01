import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-xl p-3 shadow-lg">
        <p className="mb-2 font-semibold text-white">{label}</p>
        {payload.map((entry) => (
          <p key={entry.dataKey} className="text-sm text-slate-300" style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ForecastComparisonChart({ data = [] }) {
  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Prophet vs ARIMA (Grouped Forecasts)
      </h3>
      <div className="h-72 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 6, right: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
              <XAxis
                dataKey="name"
                stroke="#a5a8be"
                style={{ fontSize: "12px" }}
                interval={0}
                angle={-12}
                height={50}
                textAnchor="end"
              />
              <YAxis stroke="#a5a8be" style={{ fontSize: "12px" }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#a5a8be", fontSize: "12px" }} />
              <Bar dataKey="Prophet" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              <Bar dataKey="ARIMA" fill="#a855f7" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            No comparison data available yet.
          </div>
        )}
      </div>
    </div>
  );
}
