import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  roles: string[];
  // P0-11: when true, the app should redirect the user to a
  // change-password flow before granting access to any other page.
  mustChangePassword?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  permissions: string[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  permissions: string[];
  setSession: (payload: LoginResponse) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      permissions: [],
      setSession: (payload) =>
        set({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          user: payload.user,
          permissions: payload.permissions,
        }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null, permissions: [] }),
      hasPermission: (permission) => get().permissions.includes(permission),
    }),
    { name: 'erp-auth' },
  ),
);
