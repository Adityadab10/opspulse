import { useAuth } from "../auth/authContextValue";

export default function TenantSwitcher() {
  const { tenantIds, selectedTenantId, selectTenant } = useAuth();

  if (tenantIds.length <= 1) return null;

  return (
    <div className="border-b border-cyan-400/20 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 md:px-8">
      <label className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-cyan-200">Tenant</span>
        <select
          value={selectedTenantId || ""}
          onChange={(event) => selectTenant(event.target.value)}
          className="rounded-lg border border-cyan-400/30 bg-slate-900 px-3 py-2 text-slate-100"
        >
          <option value="" disabled>Select a tenant</option>
          {tenantIds.map((tenantId) => <option key={tenantId} value={tenantId}>{tenantId}</option>)}
        </select>
      </label>
    </div>
  );
}
