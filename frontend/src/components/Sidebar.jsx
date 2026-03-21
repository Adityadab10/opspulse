import { NavLink, useNavigate } from "react-router-dom";

export default function Sidebar() {
  const navigate = useNavigate();

  const signOut = () => {
    localStorage.removeItem("inventory_user");
    navigate("/login");
  };

  const linkClass = ({ isActive }) =>
    `block rounded-lg px-4 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-teal-700 text-white"
        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <aside className="w-full border-r border-slate-200 bg-white/80 p-4 md:w-64">
      <h2 className="mb-6 text-lg font-bold text-slate-900">Inventory Intelligence</h2>
      <nav className="space-y-2">
        <NavLink to="/dashboard" className={linkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/upload" className={linkClass}>
          Upload CSV
        </NavLink>
        <NavLink to="/alerts" className={linkClass}>
          Alerts
        </NavLink>
      </nav>

      <button
        onClick={signOut}
        className="mt-8 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        Logout
      </button>
    </aside>
  );
}