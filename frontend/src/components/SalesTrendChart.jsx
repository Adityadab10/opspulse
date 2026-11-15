import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function SalesTrendChart({ data = [] }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-slate-500/20 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        No sales records match this date range.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.12)" />
          <XAxis dataKey="month" stroke="#a5a8be" style={{ fontSize: "12px" }} />
          <YAxis stroke="#a5a8be" style={{ fontSize: "12px" }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid rgba(139, 92, 246, 0.35)", borderRadius: "12px" }}
            labelStyle={{ color: "#f8fafc" }}
          />
          <Line
            type="monotone"
            dataKey="quantity"
            name="Units sold"
            stroke="#22d3ee"
            strokeWidth={3}
            dot={{ fill: "#22d3ee", strokeWidth: 2, r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
