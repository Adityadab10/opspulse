const getDecision = (percent) => {
  if (percent > 10) return { 
    label: "Increase", 
    color: "bg-green-500/20 text-green-400 border border-green-500/30" 
  };
  if (percent < -10) return { 
    label: "Reduce", 
    color: "bg-red-500/20 text-red-400 border border-red-500/30" 
  };
  return { 
    label: "Maintain", 
    color: "bg-amber-500/20 text-amber-400 border border-amber-500/30" 
  };
};

export default function ProductTable({ rows }) {
  return (
    <div className="glass rounded-2xl p-6 transition-all hover:border-purple-500/40">
      <h3 className="mb-6 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent">
        Product Analysis
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-purple-500/20">
            <tr>
              <th className="px-4 py-4 font-semibold text-slate-300">Product Name</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Category</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Avg Monthly Sales</th>
              <th className="px-4 py-4 font-semibold text-slate-300">% Change</th>
              <th className="px-4 py-4 font-semibold text-slate-300">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = getDecision(row.percentChange);
              return (
                <tr 
                  key={row.name + i} 
                  className="border-b border-purple-500/10 transition-colors hover:bg-purple-500/5"
                >
                  <td className="px-4 py-4 font-medium text-white">{row.name}</td>
                  <td className="px-4 py-4 text-slate-400">{row.category}</td>
                  <td className="px-4 py-4 text-slate-400">{row.avgSales}</td>
                  <td className="px-4 py-4 text-slate-400">{row.percentChange}%</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${d.color}`}>
                      {d.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-400" colSpan={5}>
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