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
    return <div className="p-8 text-slate-700">Loading dashboard...</div>;
  }

  return (
    <div className="page-shell md:flex">
      <Sidebar />
      <main className="flex-1 space-y-6 p-4 md:p-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPIcard title="Total Products" value={summary.totalProducts ?? 0} />
          <KPIcard title="Avg Monthly Sales" value={summary.avgMonthlySales ?? 0} />
          <KPIcard title="Active Alerts" value={summary.activeAlerts ?? 0} />
          <KPIcard title="Recommendations Ready" value={summary.recommendationsReady ?? 0} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LineChart trends={trends} />
          </div>
          <DonutChart />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ProductTable rows={analysis} />
          </div>
          <AlertList alerts={alerts} />
        </section>
      </main>
    </div>
  );
}