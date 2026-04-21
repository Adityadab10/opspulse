import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";

const COLORS = ["#10b981", "#f59e0b", "#ef4444"];

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-xl p-3 shadow-lg">
        <p className="font-semibold text-white">{payload[0].name}</p>
        <p className="text-sm text-slate-300">Count: {payload[0].value}</p>
      </div>
    );
  }
  return null;
};

export default function DonutChart({ data = [] }) {
  const chartData = Array.isArray(data) && data.length
    ? data
    : [
        { name: "Increase", value: 0 },
        { name: "Maintain", value: 0 },
        { name: "Reduce", value: 0 },
      ];

  const total = chartData.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  return (
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Decision Distribution
      </h3>
      <div className="flex h-80 w-full items-center justify-center">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                paddingAngle={2}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={COLORS[index % COLORS.length]}
                    stroke="rgba(139, 92, 246, 0.2)"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-center text-sm text-slate-400">
            No prediction decisions available yet.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-6 text-sm">
        {chartData.map((d, i) => (
          <span key={d.name} className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full shadow-lg"
              style={{
                background: COLORS[i],
                boxShadow: `0 0 10px ${COLORS[i]}50`
              }}
            />
            <span className="text-slate-300">{d.name}: {d.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}