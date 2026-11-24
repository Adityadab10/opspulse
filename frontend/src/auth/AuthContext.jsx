import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/react";
import { AuthContext } from "./authContextValue";
import api, { setApiErrorHandler, setSessionTokenProvider } from "../services/api";
import { selectTenantId } from "../services/authSupport";
import { clearSelectedTenantId, setSelectedTenantId } from "../services/tenantState";

function SessionContext({ children, session }) {
  const { user: profile, isLoaded: profileLoaded } = useUser();
  const { signOut } = useClerk();
  const [membership, setMembership] = useState({
    tenantIds: [], selectedTenantId: null, loading: Boolean(session.sessionId), claimsError: null,
  });
  const [apiError, setApiError] = useState(null);
  const request = useRef(0);
  const selected = useRef(null);
  const { getToken, sessionId } = session;

  const refreshClaims = useCallback(async () => {
    const version = ++request.current;
    try {
      const { data } = await api.get("/session/memberships", { ignoreTenant: true });
      if (request.current !== version) return;
      const tenantIds = data.memberships.map(({ tenantId }) => tenantId);
      selected.current = selectTenantId({ tenantIds, previousTenantId: selected.current });
      setSelectedTenantId(selected.current);
      setMembership({ tenantIds, selectedTenantId: selected.current, loading: false, claimsError: null });
    } catch {
      if (request.current !== version) return;
      selected.current = null;
      clearSelectedTenantId();
      setMembership({
        tenantIds: [], selectedTenantId: null, loading: false, claimsError: "Unable to load tenant membership.",
      });
    }
  }, []);

  useEffect(() => {
    clearSelectedTenantId();
    setSessionTokenProvider(sessionId ? getToken : null);
    setApiErrorHandler((error) => {
      setApiError(error);
      if (error.status === 401 && sessionId) void signOut().catch(() => {});
    });
    if (sessionId) void refreshClaims();
    return () => {
      request.current += 1;
      clearSelectedTenantId();
      setSessionTokenProvider(null);
      setApiErrorHandler(null);
    };
  }, [getToken, refreshClaims, sessionId, signOut]);

  const selectTenant = (tenantId) => {
    if (!membership.tenantIds.includes(tenantId)) return false;
    selected.current = setSelectedTenantId(tenantId);
    setMembership((current) => ({ ...current, selectedTenantId: tenantId }));
    setApiError(null);
    return true;
  };
  const user = session.isSignedIn && profile ? {
    id: profile.id, name: profile.fullName, email: profile.primaryEmailAddress?.emailAddress,
  } : null;

  return (
    <AuthContext.Provider value={{
      ...membership,
      loading: !session.isLoaded || !profileLoaded || membership.loading,
      user,
      hasTenantAccess: membership.tenantIds.length > 0,
      apiError,
      clearApiError: () => setApiError(null),
      selectTenant,
      refreshClaims,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }) {
  const session = useClerkAuth();
  return <SessionContext key={session.sessionId || "signed-out"} session={session}>{children}</SessionContext>;
}
