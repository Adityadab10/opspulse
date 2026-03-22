export default function KPIcard({ title, value }) {
  return (
    <div className="glass group rounded-2xl p-6 transition-all hover:scale-105 hover:border-purple-500/40">
      <p className="text-sm font-medium text-slate-400">{title}</p>
      <p className="mt-3 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-3xl font-bold text-transparent">
        {value}
      </p>
    </div>
  );
}