'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AuthzAction } from '@/db/schema-authz';
import {
  canAccessClientModule,
  type ClientAuthzState,
} from '@/lib/authz/guards';
import type { PageKey } from '@/lib/authz/route-registry';

export { canAccessClientModule, type ClientAuthzState };

const DEFAULT_CLIENT_AUTHZ_STATE: ClientAuthzState = {
  userId: null,
  role: null,
  status: null,
  authzVersion: 0,
  grants: {},
};

const AuthzContext = createContext<ClientAuthzState>(DEFAULT_CLIENT_AUTHZ_STATE);

export interface AuthzProviderProps {
  readonly value: ClientAuthzState;
  readonly children: ReactNode;
}

export function AuthzProvider({ value, children }: AuthzProviderProps) {
  return <AuthzContext.Provider value={value}>{children}</AuthzContext.Provider>;
}

export function useAuthorization() {
  const state = useContext(AuthzContext);

  return useMemo(
    () => ({
      ...state,
      isAuthenticated: Boolean(state.userId && state.status === 'ACTIVE'),
      isSuperAdmin: state.status === 'ACTIVE' && state.role === 'SUPER_ADMIN',
      isAdmin: state.status === 'ACTIVE' && state.role === 'ADMIN',
      can: (pageKey: PageKey, action: AuthzAction = 'read') =>
        canAccessClientModule(state, pageKey, action),
    }),
    [state]
  );
}

export interface AccessBoundaryProps {
  readonly pageKey: PageKey;
  readonly action?: AuthzAction;
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Fronteira declarativa de renderização condicional para módulos protegidos (UX Defensiva).
 * Importante: a segurança real é sempre imposta nos Guards/Middleware no Edge;
 * nunca acoplada a app/scene.tsx.
 */
export function AccessBoundary({
  pageKey,
  action = 'read',
  fallback = null,
  children,
}: AccessBoundaryProps) {
  const { can } = useAuthorization();
  if (!can(pageKey, action)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
