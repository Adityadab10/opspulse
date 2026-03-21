import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#16a34a", "#f59e0b", "#dc2626"];

export default function DonutChart() {
  const data = [
    { name: "Increase", value: 40 },
    { name: "Maintain", value: 35 },
    { name: "Reduce", value: 25 },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">Decision Distribution</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-slate-600">
        {data.map((d, i) => (
          <span key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i] }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}