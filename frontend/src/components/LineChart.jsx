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
const pipelineStages = [
  { label: "Rule", key: "rulePrediction" },
  { label: "ML", key: "mlPrediction" },
  { label: "Adjusted", key: "adjustedPrediction" },
];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export default function LineChart({ predictions = [] }) {
  const rankedProducts = (Array.isArray(predictions) ? predictions : [])
    .map((item) => {
      const rule = toNumber(item?.rulePrediction, 0);
      const adjusted = toNumber(item?.adjustedPrediction, rule);
      return {
        label: item?.productId?.name || "Unknown Product",
        rulePrediction: rule,
        mlPrediction: toNumber(item?.mlPrediction, rule),
        adjustedPrediction: adjusted,
        impactScore: Math.abs(adjusted - rule),
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 3);

  const rows = pipelineStages.map((stage) => {
    const point = { stage: stage.label };
    rankedProducts.forEach((item) => {
      point[item.label] = toNumber(item[stage.key], 0);
    });
    return point;
  });

  const hasData = rankedProducts.length > 0;

  return (
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Prediction Trends (Top Impacted Products)
      </h3>
      <div className="h-80 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
              <XAxis
                dataKey="stage"
                stroke="#a5a8be"
                style={{ fontSize: "12px" }}
              />
              <YAxis
                stroke="#a5a8be"
                style={{ fontSize: "12px" }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{
                  color: "#a5a8be",
                  fontSize: "14px",
                  paddingTop: "20px",
                }}
              />
              {rankedProducts.map((item, index) => (
                <Line
                  key={item.label}
                  type="monotone"
                  dataKey={item.label}
                  stroke={palette[index % palette.length]}
                  strokeWidth={3}
                  dot={{ fill: palette[index % palette.length], strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: palette[index % palette.length] }}
                />
              ))}
            </ReLineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
            Run predictions to visualize trend progression from rule to adjusted outputs.
          </div>
        )}
      </div>
    </div>
  );
}