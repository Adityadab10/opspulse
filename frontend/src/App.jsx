import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/authContextValue";
import TenantSwitcher from "./components/TenantSwitcher";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import Alerts from "./pages/Alerts";
import ProductManagement from "./pages/ProductManagement";
import SalesManagement from "./pages/SalesManagement";
import Forecasting from "./pages/Forecasting";
import InventoryIntelligence from "./pages/InventoryIntelligence";
import InventoryAgent from "./pages/InventoryAgent";
import AiAnalyst from "./pages/AiAnalyst";
import AppHeader from "./components/AppHeader";

function StatusBanner() {
  const { apiError, clearApiError } = useAuth();
  if (!apiError || apiError.status === 401) return null;

  return (
    <div className="border-b border-amber-400/30 bg-amber-950/70 px-4 py-3 text-sm text-amber-100 md:px-8" role="alert">
      <div className="flex items-center justify-between gap-4">
        <span>{apiError.message}</span>
        <button type="button" onClick={clearApiError} className="text-amber-200 underline">Dismiss</button>
      </div>
    </div>
  );
}

function TenantAccessState({ multiple = false }) {
  const { tenantIds, selectedTenantId, selectTenant, refreshClaims, signOut } = useAuth();

  if (multiple) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-slate-900/80 p-8">
          <h1 className="text-2xl font-bold text-cyan-100">Select a tenant</h1>
          <p className="mt-2 text-slate-400">Choose the tenant whose data you want to access.</p>
          <select
            value={selectedTenantId || ""}
            onChange={(event) => selectTenant(event.target.value)}
            className="mt-6 w-full rounded-lg border border-cyan-400/30 bg-slate-950 px-3 py-3 text-slate-100"
          >
            <option value="" disabled>Select a tenant</option>
            {tenantIds.map((tenantId) => <option key={tenantId} value={tenantId}>{tenantId}</option>)}
          </select>
          <div className="mt-6 flex gap-4 text-sm">
            <button type="button" onClick={() => refreshClaims()} className="text-cyan-200 underline">Refresh membership</button>
            <button type="button" onClick={() => signOut()} className="text-slate-400 underline">Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-amber-400/20 bg-slate-900/80 p-8">
        <h1 className="text-2xl font-bold text-amber-100">Tenant access is not configured</h1>
        <p className="mt-2 text-slate-400">Your Firebase account has no tenant membership. Contact an administrator.</p>
        <div className="mt-6 flex gap-4 text-sm">
          <button type="button" onClick={() => refreshClaims()} className="text-cyan-200 underline">Refresh membership</button>
          <button type="button" onClick={() => signOut()} className="text-slate-400 underline">Sign out</button>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading, tenantIds, selectedTenantId, claimsError } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (claimsError) return <TenantAccessState />;
  if (!tenantIds.length) return <TenantAccessState />;
  if (tenantIds.length > 1 && !selectedTenantId) return <TenantAccessState multiple />;

  return (
    <>
      <StatusBanner />
      <TenantSwitcher />
      <AppHeader />
      {children}
    </>
  );
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-white">Loading...</div>;
  }
  return user ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route
          path="/dashboard"
          element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
        />
        <Route
          path="/upload"
          element={<ProtectedRoute><Upload /></ProtectedRoute>}
        />
        <Route
          path="/alerts"
          element={<ProtectedRoute><Alerts /></ProtectedRoute>}
        />
        <Route
          path="/products/:productId"
          element={<ProtectedRoute><ProductManagement /></ProtectedRoute>}
        />
        <Route
          path="/products"
          element={<ProtectedRoute><ProductManagement /></ProtectedRoute>}
        />
        <Route
          path="/sales"
          element={<ProtectedRoute><SalesManagement /></ProtectedRoute>}
        />
        <Route
          path="/forecasting"
          element={<ProtectedRoute><Forecasting /></ProtectedRoute>}
        />
        <Route
          path="/inventory"
          element={<ProtectedRoute><InventoryIntelligence /></ProtectedRoute>}
        />
        <Route path="/inventory-agent" element={<ProtectedRoute><InventoryAgent /></ProtectedRoute>} />
        <Route path="/ai-analyst" element={<ProtectedRoute><AiAnalyst /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
