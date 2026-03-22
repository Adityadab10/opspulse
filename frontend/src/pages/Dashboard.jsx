import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import KPIcard from "../components/KPIcard";
import LineChart from "../components/LineChart";
import DonutChart from "../components/DonutChart";
import ProductTable from "../components/ProductTable";
import AlertList from "../components/AlertList";
import { alertsApi, dashboardApi, productsApi } from "../services/api";

export default function Dashboard() {
  const [summary, setSummary] = useState({
    totalProducts: 0,
    avgMonthlySales: 0,
    activeAlerts: 0,
    recommendationsReady: 0,
  });
  const [trends, setTrends] = useState([]);
  const [analysis, setAnalysis] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        const [summaryRes, trendsRes, analysisRes, alertsRes] = await Promise.all([
          dashboardApi.getSummary(),
          dashboardApi.getTrends(),
          productsApi.getAnalysis(),
          alertsApi.getAlerts(),
        ]);
        setSummary(summaryRes.data || {});
        setTrends(trendsRes.data || []);
        setAnalysis(analysisRes.data || []);
        setAlerts(alertsRes.data || []);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="page-shell flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500/20 border-t-purple-500"></div>
          <p className="text-slate-300">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 space-y-6 p-4 md:p-8">
        {/* Header with gradient */}
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-white via-purple-200 to-purple-400 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 text-slate-400">
            Welcome back! Here's what's happening with your inventory today.
          </p>
        </div>

        {/* KPI Cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPIcard title="Total Products" value={summary.totalProducts ?? 0} />
          <KPIcard title="Avg Monthly Sales" value={summary.avgMonthlySales ?? 0} />
          <KPIcard title="Active Alerts" value={summary.activeAlerts ?? 0} />
          <KPIcard title="Recommendations Ready" value={summary.recommendationsReady ?? 0} />
        </section>

        {/* Charts Section */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LineChart trends={trends} />
          </div>
          <DonutChart />
        </section>

        {/* Table & Alerts Section */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ProductTable rows={analysis} />
          </div>
          <AlertList alerts={alerts} />
        </section>
      </main>
    </div>
  );
}