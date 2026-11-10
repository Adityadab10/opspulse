import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { auth } from "../../firebase.config";
import { AuthContext } from "./authContextValue";
import { setApiErrorHandler } from "../services/api";
import { extractTenantMemberships, selectTenantId } from "../services/authSupport";
import { clearSelectedTenantId, setSelectedTenantId } from "../services/tenantState";

const initialState = {
  user: null,
  tenantIds: [],
  selectedTenantId: null,
  loading: true,
  claimsError: null,
  apiError: null,
};

export function AuthProvider({ children }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const eventRef = useRef(0);

  const commitState = useCallback((nextState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const applyTokenClaims = useCallback((user, tokenResult, eventId, selectionOverride) => {
    if (eventId !== eventRef.current || auth?.currentUser?.uid !== user.uid) return;

    const tenantIds = extractTenantMemberships(tokenResult?.claims || {});
    const previousTenantId = selectionOverride !== undefined
      ? selectionOverride
      : stateRef.current.user?.uid === user.uid
        ? stateRef.current.selectedTenantId
        : null;
    const selectedTenantId = selectTenantId({ tenantIds, previousTenantId });

    const nextState = {
      ...stateRef.current,
      user,
      tenantIds,
      selectedTenantId,
      loading: false,
      claimsError: null,
    };
    setSelectedTenantId(selectedTenantId);
    commitState(nextState);
  }, [commitState]);

  const refreshClaims = useCallback(async () => {
    const user = auth?.currentUser;
    if (!user) return [];

    try {
      const tokenResult = await user.getIdTokenResult(true);
      applyTokenClaims(user, tokenResult, eventRef.current, stateRef.current.selectedTenantId);
      return extractTenantMemberships(tokenResult?.claims || {});
    } catch (error) {
      commitState({
        ...stateRef.current,
        claimsError: error?.message || "Unable to refresh tenant membership.",
      });
      return [];
    }
  }, [applyTokenClaims, commitState]);

  useEffect(() => {
    const handleApiError = (apiError) => {
      const nextState = { ...stateRef.current, apiError };
      commitState(nextState);

      if (apiError.status === 401 && auth?.currentUser) {
        signOut(auth).catch(() => {});
      }
    };

    setApiErrorHandler(handleApiError);
    return () => setApiErrorHandler(null);
  }, [commitState]);

  useEffect(() => {
    if (!auth) {
      commitState({
        ...initialState,
        loading: false,
        claimsError: "Firebase authentication is unavailable.",
      });
      return undefined;
    }

    const unsubscribe = onIdTokenChanged(auth, (user) => {
      const eventId = eventRef.current + 1;
      eventRef.current = eventId;

      if (!user) {
        clearSelectedTenantId();
        localStorage.removeItem("inventory_user");
        commitState({ ...initialState, loading: false });
        return;
      }

      const sameAccount = stateRef.current.user?.uid === user.uid;
      const previousTenantId = sameAccount ? stateRef.current.selectedTenantId : null;
      if (sameAccount) setSelectedTenantId(previousTenantId);
      else clearSelectedTenantId();
      commitState({
        ...stateRef.current,
        user,
        tenantIds: [],
        selectedTenantId: previousTenantId,
        loading: true,
        claimsError: null,
        apiError: null,
      });

      localStorage.setItem("inventory_user", JSON.stringify({
        uid: user.uid,
        name: user.displayName || "User",
        email: user.email,
        provider: user.providerData?.[0]?.providerId || "email",
      }));

      user.getIdTokenResult().then((tokenResult) => {
        applyTokenClaims(user, tokenResult, eventId, previousTenantId);
      }).catch((error) => {
        if (eventId !== eventRef.current || auth.currentUser?.uid !== user.uid) return;
        commitState({
          ...stateRef.current,
          loading: false,
          claimsError: error?.message || "Unable to load tenant membership.",
        });
      });
    });

    return unsubscribe;
  }, [applyTokenClaims, commitState]);

  const selectTenant = useCallback((tenantId) => {
    if (!stateRef.current.tenantIds.includes(tenantId)) return false;

    const nextState = {
      ...stateRef.current,
      selectedTenantId: tenantId,
      apiError: null,
    };
    setSelectedTenantId(tenantId);
    commitState(nextState);
    return true;
  }, [commitState]);

  const clearApiError = useCallback(() => {
    commitState({ ...stateRef.current, apiError: null });
  }, [commitState]);

  const value = useMemo(() => ({
    ...state,
    hasTenantAccess: state.tenantIds.length > 0,
    selectTenant,
    refreshClaims,
    clearApiError,
    signOut: () => signOut(auth),
  }), [clearApiError, refreshClaims, selectTenant, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

