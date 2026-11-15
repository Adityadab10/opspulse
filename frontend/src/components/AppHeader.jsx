import { ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/authContextValue";

const titles = { "/dashboard": ["Dashboard", "Overview"], "/products": ["Products", "Operations"], "/sales": ["Sales", "Operations"], "/forecasting": ["Demand Forecasting", "Intelligence"], "/inventory": ["Inventory Intelligence", "Intelligence"], "/ai-analyst": ["AI Analyst", "AI workspace"], "/inventory-agent": ["Inventory Agent", "AI workspace"] };
export default function AppHeader() {
  const { pathname } = useLocation(); const { selectedTenantId } = useAuth(); const [title, section] = titles[pathname] || ["Workspace", "OpsPulse"];
  return <header className="app-header"><div><div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span>{section}</span><ChevronRight className="h-3 w-3" /><span className="text-slate-300">{title}</span></div><h1 className="text-xl font-bold tracking-tight text-white sm:mt-1 sm:text-2xl">{title}</h1></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">Active tenant</p><p className="mt-1 max-w-[180px] truncate text-sm font-medium text-cyan-200">{selectedTenantId || "—"}</p></div></header>;
}
