import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const palette = ["#0f766e", "#0369a1", "#7c3aed"];

const monthLabels = () => {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return d.toLocaleDateString("en-US", { month: "short" });
  });
};

export default function LineChart({ trends }) {
  const labels = monthLabels();
  const rows = labels.map((label, idx) => {
    const point = { month: label };
    trends.forEach((p) => {
      point[p.product] = p.data[idx] ?? 0;
    });
    return point;
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">Sales Trends (Top 3 Products)</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ReLineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            {trends.map((item, index) => (
              <Line
                key={item.product}
                type="monotone"
                dataKey={item.product}
                stroke={palette[index % palette.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}