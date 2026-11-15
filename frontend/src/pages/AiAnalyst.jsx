import Sidebar from "../components/Sidebar";
import AiAnalystPanel from "../components/AiAnalystPanel";

export default function AiAnalyst() {
  return <div className="flex min-h-screen flex-col bg-black text-white md:flex-row"><Sidebar /><main className="flex-1 p-5 md:p-8"><div className="mx-auto max-w-4xl"><p className="text-sm uppercase tracking-[0.25em] text-cyan-300">Grounded business assistant</p><h1 className="mt-2 text-3xl font-bold">AI Analyst</h1><p className="mt-2 mb-6 text-slate-400">Answers use tenant-scoped business records, persisted forecasts, and advisory inventory calculations. It cannot change your data.</p><AiAnalystPanel /></div></main></div>;
}
