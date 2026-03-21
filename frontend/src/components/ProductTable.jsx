const getDecision = (percent) => {
  if (percent > 10) return { label: "Increase", color: "bg-green-100 text-green-700" };
  if (percent < -10) return { label: "Reduce", color: "bg-red-100 text-red-700" };
  return { label: "Maintain", color: "bg-amber-100 text-amber-700" };
};

export default function ProductTable({ rows }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">Product Analysis</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-2 py-3">Product Name</th>
              <th className="px-2 py-3">Category</th>
              <th className="px-2 py-3">Avg Monthly Sales</th>
              <th className="px-2 py-3">% Change</th>
              <th className="px-2 py-3">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = getDecision(row.percentChange);
              return (
                <tr key={row.name + i} className="border-b border-slate-100">
                  <td className="px-2 py-3 font-medium text-slate-900">{row.name}</td>
                  <td className="px-2 py-3 text-slate-600">{row.category}</td>
                  <td className="px-2 py-3 text-slate-600">{row.avgSales}</td>
                  <td className="px-2 py-3 text-slate-600">{row.percentChange}%</td>
                  <td className="px-2 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${d.color}`}>
                      {d.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td className="px-2 py-4 text-slate-500" colSpan={5}>
                  No analysis data found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}