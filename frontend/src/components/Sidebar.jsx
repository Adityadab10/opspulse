import { useState } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, Boxes, BrainCircuit, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Menu, PackageSearch, ShoppingCart, Sparkles, X } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase.config";
import { useAuth } from "../auth/authContextValue";

const groups = [
  { label: "Overview", links: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { label: "Operations", links: [{ to: "/products", label: "Products", icon: Boxes }, { to: "/sales", label: "Sales", icon: ShoppingCart }] },
  { label: "Intelligence", links: [{ to: "/forecasting", label: "Demand Forecasting", icon: BarChart3 }, { to: "/inventory", label: "Inventory Intelligence", icon: PackageSearch }] },
  { label: "AI workspace", links: [{ to: "/ai-analyst", label: "AI Analyst", icon: Sparkles }, { to: "/inventory-agent", label: "Inventory Agent", icon: BrainCircuit }] },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const { user } = useAuth();
  const logout = async () => { await signOut(auth); localStorage.removeItem("inventory_user"); };
  return <>
    <button type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="fixed left-4 top-4 z-40 rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-200 md:hidden"><Menu className="h-5 w-5" /></button>
    {mobileOpen ? <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/70 md:hidden" /> : null}
    <aside className={`app-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-5"><NavLink to="/dashboard" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 font-black text-slate-950">O</span><span className="sidebar-label text-lg font-bold tracking-tight">OpsPulse</span></NavLink><button type="button" aria-label="Collapse navigation" onClick={() => setCollapsed((value) => !value)} className="hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white md:block">{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button><button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 md:hidden"><X className="h-5 w-5" /></button></div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6">{groups.map((group) => <div key={group.label}><p className="sidebar-label mb-2 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">{group.label}</p>{group.links.map((link) => { const LinkIcon = link.icon; return <NavLink key={link.to} to={link.to} onClick={() => setMobileOpen(false)} title={collapsed ? link.label : undefined} className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}><LinkIcon className="h-[18px] w-[18px] shrink-0" /><span className="sidebar-label">{link.label}</span></NavLink>; })}</div>)}</nav>
      <div className="border-t border-slate-800 p-3"><div className="mb-2 flex items-center gap-3 rounded-lg bg-slate-900/70 p-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-cyan-200">{user?.email?.[0]?.toUpperCase() || "U"}</span><span className="sidebar-label min-w-0 truncate text-xs text-slate-300">{user?.email || "Retail operator"}</span></div><button type="button" onClick={logout} className="sidebar-link w-full text-slate-400 hover:text-white"><LogOut className="h-[18px] w-[18px]" /><span className="sidebar-label">Sign out</span></button></div>
    </aside>
  </>;
}
