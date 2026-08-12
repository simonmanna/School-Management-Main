import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  roles: string[];
}

export interface SessionOrganization {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  permissions: string[];
  organization?: SessionOrganization;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  organization: SessionOrganization | null;
  permissions: string[];
  /** Active branch for the session. null = all branches (org-wide). */
  currentBranchId: string | null;
  setSession: (payload: LoginResponse) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setOrganization: (org: SessionOrganization) => void;
  setCurrentBranch: (id: string | null) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      organization: null,
      permissions: [],
      currentBranchId: null,
      setSession: (payload) =>
        set({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          user: payload.user,
          organization: payload.organization ?? null,
          permissions: payload.permissions,
        }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setOrganization: (organization) => set({ organization }),
      setCurrentBranch: (currentBranchId) => set({ currentBranchId }),
      clear: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          organization: null,
          permissions: [],
        }),
      hasPermission: (permission) => get().permissions.includes(permission),
    }),
    {
      name: 'cafe-pos-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        organization: state.organization,
        permissions: state.permissions,
        currentBranchId: state.currentBranchId,
      }),
    },
  ),
);
