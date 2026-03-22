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

const palette = ["#8b5cf6", "#06b6d4", "#f59e0b"];

const monthLabels = () => {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return d.toLocaleDateString("en-US", { month: "short" });
  });
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-xl p-3 shadow-lg">
        <p className="mb-2 font-semibold text-white">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm text-slate-300" style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
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
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Sales Trends (Top 3 Products)
      </h3>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ReLineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
            <XAxis 
              dataKey="month" 
              stroke="#a5a8be"
              style={{ fontSize: '12px' }}
            />
            <YAxis 
              stroke="#a5a8be"
              style={{ fontSize: '12px' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              wrapperStyle={{ 
                color: '#a5a8be',
                fontSize: '14px',
                paddingTop: '20px'
              }}
            />
            {trends.map((item, index) => (
              <Line
                key={item.product}
                type="monotone"
                dataKey={item.product}
                stroke={palette[index % palette.length]}
                strokeWidth={3}
                dot={{ fill: palette[index % palette.length], strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, fill: palette[index % palette.length] }}
              />
            ))}
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}