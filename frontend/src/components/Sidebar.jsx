import { NavLink, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase.config";
import toast from "react-hot-toast";

export default function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      // Sign out from Firebase first
      await signOut(auth);
      
      // Clear localStorage
      localStorage.removeItem("inventory_user");
      
      // Navigate to landing page
      navigate("/", { replace: true });
      toast.success("Logged out successfully!");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Logout failed. Please try again.");
    }
  };

  const linkClass = ({ isActive }) =>
    `group relative block rounded-xl px-4 py-3 text-sm font-medium transition-all ${
      isActive
        ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/40"
        : "text-slate-300 hover:bg-purple-500/10 hover:text-white"
    }`;

  return (
    <aside className="glass w-full border-r border-purple-500/10 p-4 md:w-64">
      <div className="mb-8 flex items-center space-x-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/40">
          <span className="text-xl font-bold text-white">I</span>
        </div>
        <h2 className="text-lg font-bold text-white">Inventory Intel</h2>
      </div>

      <nav className="space-y-2">
        <NavLink to="/dashboard" className={linkClass}>
          <span className="flex items-center space-x-2">
            <span>📊</span>
            <span>Dashboard</span>
          </span>
        </NavLink>
        <NavLink to="/upload" className={linkClass}>
          <span className="flex items-center space-x-2">
            <span>📁</span>
            <span>Upload CSV</span>
          </span>
        </NavLink>
        <NavLink to="/alerts" className={linkClass}>
          <span className="flex items-center space-x-2">
            <span>🔔</span>
            <span>Alerts</span>
          </span>
        </NavLink>
      </nav>

      <button
        onClick={handleLogout}
        className="mt-8 w-full rounded-xl border border-purple-500/20 bg-purple-500/5 px-4 py-3 text-sm font-semibold text-slate-300 transition-all hover:border-purple-500/40 hover:bg-purple-500/10 hover:text-white"
      >
        Logout
      </button>
    </aside>
  );
}